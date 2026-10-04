use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

const REQUIRED_RUNTIME_SCHEMA: u64 = 3;

#[derive(Clone, Default)]
struct RenderTaskState {
    pid: Arc<Mutex<Option<u32>>>,
    cancel_requested: Arc<AtomicBool>,
}

struct EngineWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_tail: Arc<Mutex<Vec<String>>>,
    runtime_home: PathBuf,
    device_mode: String,
}

#[derive(Clone, Default)]
struct EngineWorkerState {
    worker: Arc<Mutex<Option<EngineWorker>>>,
}

#[cfg(debug_assertions)]
fn dev_project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve VideoMagic development root".to_string())
}

fn runtime_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(dir.join("runtime-location.txt"))
}

fn render_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(dir.join("render-history.json"))
}

fn read_render_history(app: &AppHandle) -> Result<Vec<Value>, String> {
    let path = render_history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read render history: {error}"))?;
    serde_json::from_str::<Vec<Value>>(&content)
        .map_err(|error| format!("Could not parse render history: {error}"))
}

fn write_render_history(app: &AppHandle, items: &[Value]) -> Result<(), String> {
    let path = render_history_path(app)?;
    let content = serde_json::to_string_pretty(items)
        .map_err(|error| format!("Could not serialize render history: {error}"))?;
    fs::write(path, content.as_bytes())
        .map_err(|error| format!("Could not save render history: {error}"))
}

fn remember_render(
    app: &AppHandle,
    source_video: &str,
    result: &Value,
    voice: &str,
    speed: f64,
    original_volume: f64,
    ducking: bool,
    auto_timing: bool,
    subtitles: bool,
    device_mode: &str,
) -> Result<(), String> {
    let output_path = result
        .get("video")
        .and_then(|video| video.get("path"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    if output_path.is_empty() {
        return Ok(());
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_secs();

    let mut items = read_render_history(app)?;
    items.retain(|item| {
        item.get("path")
            .and_then(Value::as_str)
            .map(|value| value != output_path)
            .unwrap_or(true)
    });

    items.insert(
        0,
        json!({
            "id": format!("render-{created_at}"),
            "path": output_path,
            "name": Path::new(output_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("VideoMagic export"),
            "sourceVideo": source_video,
            "createdAt": created_at,
            "exists": Path::new(output_path).exists(),
            "durationSeconds": result
                .get("video")
                .and_then(|video| video.get("videoDurationSeconds"))
                .cloned()
                .unwrap_or(Value::Null),
            "voice": voice,
            "speed": speed,
            "originalVolume": original_volume,
            "ducking": ducking,
            "autoTiming": auto_timing,
            "subtitles": subtitles,
            "deviceMode": device_mode,
            "narrationPath": result.get("narrationPath").cloned().unwrap_or(Value::Null),
            "subtitlePath": result
                .get("subtitles")
                .and_then(|value| value.get("path"))
                .cloned()
                .unwrap_or(Value::Null),
            "timeline": result
                .get("narration")
                .and_then(|value| value.get("timeline"))
                .cloned()
                .unwrap_or(Value::Null)
        }),
    );

    items.truncate(40);
    write_render_history(app, &items)
}

fn recent_projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(dir.join("recent-projects.json"))
}

fn read_recent_projects(app: &AppHandle) -> Result<Vec<Value>, String> {
    let path = recent_projects_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read recent projects: {error}"))?;
    serde_json::from_str::<Vec<Value>>(&content)
        .map_err(|error| format!("Could not parse recent projects: {error}"))
}

fn write_recent_projects(app: &AppHandle, items: &[Value]) -> Result<(), String> {
    let path = recent_projects_path(app)?;
    let content = serde_json::to_string_pretty(items)
        .map_err(|error| format!("Could not serialize recent projects: {error}"))?;
    fs::write(path, content.as_bytes())
        .map_err(|error| format!("Could not save recent projects: {error}"))
}

fn remember_recent_project(app: &AppHandle, target: &Path) -> Result<(), String> {
    let path_text = target.to_string_lossy().to_string();
    let mut items = read_recent_projects(app)?;
    items.retain(|item| {
        item.get("path")
            .and_then(Value::as_str)
            .map(|value| value != path_text)
            .unwrap_or(true)
    });

    let name = target
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled Project");
    let last_opened = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_secs();

    items.insert(
        0,
        json!({
            "path": path_text,
            "name": name,
            "lastOpened": last_opened,
            "exists": target.exists()
        }),
    );
    items.truncate(12);
    write_recent_projects(app, &items)
}

fn default_runtime_home(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve default local AI data directory: {error}"))?;
    Ok(dir.join("runtime-data"))
}


fn configured_runtime_home(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    // A persisted user choice must win over inherited development shell variables.
    // Otherwise a dev launcher can accidentally shadow a fully configured runtime
    // with a stale project-local VIDEOMAGIC_HOME.
    let config = runtime_config_path(app)?;
    if config.exists() {
        let value = fs::read_to_string(&config)
            .map_err(|error| format!("Could not read runtime location: {error}"))?;
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Some(PathBuf::from(trimmed)));
        }
    }

    if let Some(path) = env::var_os("VIDEOMAGIC_HOME") {
        return Ok(Some(PathBuf::from(path)));
    }

    #[cfg(debug_assertions)]
    {
        let root = dev_project_root()?;
        if let Some(parent) = root.parent() {
            return Ok(Some(parent.join("videomagic-data")));
        }
    }

    Ok(None)
}

fn persist_runtime_home(app: &AppHandle, home: &Path) -> Result<(), String> {
    let config = runtime_config_path(app)?;
    fs::write(&config, home.to_string_lossy().as_bytes())
        .map_err(|error| format!("Could not save runtime location: {error}"))
}

fn portable_python(home: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return home
            .join("runtime")
            .join("venv")
            .join("Scripts")
            .join("python.exe");
    }

    #[cfg(not(target_os = "windows"))]
    {
        home.join("runtime").join("venv").join("bin").join("python")
    }
}

#[cfg(debug_assertions)]
fn development_python() -> Result<PathBuf, String> {
    let root = dev_project_root()?;

    #[cfg(target_os = "windows")]
    {
        return Ok(root
            .join("engine")
            .join(".venv")
            .join("Scripts")
            .join("python.exe"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(root.join("engine").join(".venv").join("bin").join("python"))
    }
}

fn engine_python(home: &Path) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("VIDEOMAGIC_ENGINE_PYTHON") {
        return Ok(PathBuf::from(path));
    }

    let portable = portable_python(home);
    if portable.exists() {
        return Ok(portable);
    }

    #[cfg(debug_assertions)]
    {
        let development = development_python()?;
        if development.exists() {
            return Ok(development);
        }
    }

    Ok(portable)
}

fn local_ffmpeg(home: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return home.join("tools").join("ffmpeg").join("bin").join("ffmpeg.exe");
    }

    #[cfg(not(target_os = "windows"))]
    {
        home.join("tools").join("ffmpeg").join("bin").join("ffmpeg")
    }
}

#[cfg(debug_assertions)]
fn command_available(name: &str) -> bool {
    Command::new(name)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn ensure_runtime_dirs(local: &Path) -> Result<(), String> {
    for relative in [
        "cache/huggingface",
        "cache/torch",
        "cache/pycache",
        "tmp",
        "outputs",
        "exports",
        "previews",
    ] {
        fs::create_dir_all(local.join(relative))
            .map_err(|error| format!("Failed to create local runtime directory: {error}"))?;
    }
    Ok(())
}

fn runtime_engine_dir(local: &Path) -> Option<PathBuf> {
    let status_file = local.join("runtime").join("status.json");
    if let Ok(content) = fs::read_to_string(&status_file) {
        let content = content.trim_start_matches('\u{feff}');
        if let Ok(status) = serde_json::from_str::<Value>(content) {
            if let Some(path) = status
                .get("engineDir")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                let candidate = PathBuf::from(path);
                if candidate.join("videomagic_engine").is_dir() {
                    return Some(candidate);
                }
            }
        }
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("engine");
            if candidate.join("videomagic_engine").is_dir() {
                return Some(candidate);
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(root) = dev_project_root() {
            let candidate = root.join("engine");
            if candidate.join("videomagic_engine").is_dir() {
                return Some(candidate);
            }
        }
    }

    None
}

fn configured_engine_command(
    python: &Path,
    local: &Path,
    device_mode: Option<&str>,
) -> Command {
    let ffmpeg_bin = local.join("tools").join("ffmpeg").join("bin");
    let path_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let path_env = format!(
        "{}{}{}",
        ffmpeg_bin.display(),
        path_separator,
        env::var("PATH").unwrap_or_default()
    );

    let mut command = Command::new(python);
    command
        .args(["-m", "videomagic_engine.main"])
        .env("VIDEOMAGIC_HOME", local)
        .env("HF_HOME", local.join("cache").join("huggingface"))
        .env("TORCH_HOME", local.join("cache").join("torch"))
        .env("PYTHONPYCACHEPREFIX", local.join("cache").join("pycache"))
        .env("TMP", local.join("tmp"))
        .env("TEMP", local.join("tmp"))
        .env("TMPDIR", local.join("tmp"))
        .env("PATH", path_env);

    if let Some(engine_dir) = runtime_engine_dir(local) {
        let mut python_paths = vec![engine_dir.clone()];
        if let Some(existing) = env::var_os("PYTHONPATH") {
            python_paths.extend(env::split_paths(&existing));
        }
        if let Ok(python_path) = env::join_paths(python_paths) {
            command.env("PYTHONPATH", python_path);
        }
        command.current_dir(&engine_dir);
    }

    if let Some(mode) = device_mode {
        if matches!(mode, "cpu" | "cuda") {
            command
                .env("VIDEOMAGIC_TTS_DEVICE", mode)
                .env("VIDEOMAGIC_VISION_DEVICE", mode);
        }
    }

    command
}

fn normalized_device_mode(device_mode: &str) -> String {
    match device_mode {
        "cpu" | "cuda" => device_mode.to_string(),
        _ => "auto".to_string(),
    }
}

fn stop_engine_worker(worker: &mut Option<EngineWorker>) {
    if let Some(mut current) = worker.take() {
        let _ = current.child.kill();
        let _ = current.child.wait();
    }
}

fn start_engine_worker(local: &Path, device_mode: &str) -> Result<EngineWorker, String> {
    ensure_runtime_dirs(local)?;
    let python = engine_python(local)?;
    if !python.exists() {
        return Err(format!(
            "Local engine Python not found: {}. Run local AI setup first.",
            python.display()
        ));
    }

    let mut child = configured_engine_command(&python, local, Some(device_mode))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start local AI worker: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open AI worker stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open AI worker stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open AI worker stderr.".to_string())?;

    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_tail_worker = Arc::clone(&stderr_tail);
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut lines) = stderr_tail_worker.lock() {
                lines.push(line);
                if lines.len() > 60 {
                    lines.remove(0);
                }
            }
        }
    });

    Ok(EngineWorker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        stderr_tail,
        runtime_home: local.to_path_buf(),
        device_mode: normalized_device_mode(device_mode),
    })
}

fn run_persistent_engine_request(
    app: Option<&AppHandle>,
    engine_state: &EngineWorkerState,
    task_state: Option<&RenderTaskState>,
    local: &Path,
    request: Value,
    device_mode: &str,
    progress_event: Option<&str>,
) -> Result<Value, String> {
    let normalized_mode = normalized_device_mode(device_mode);
    let mut slot = engine_state
        .worker
        .lock()
        .map_err(|_| "Local AI worker state is unavailable.".to_string())?;

    let should_restart = match slot.as_mut() {
        Some(worker) => {
            let exited = worker
                .child
                .try_wait()
                .map_err(|error| format!("Could not inspect local AI worker: {error}"))?
                .is_some();
            exited || worker.runtime_home != local || worker.device_mode != normalized_mode
        }
        None => true,
    };

    if should_restart {
        stop_engine_worker(&mut slot);
        *slot = Some(start_engine_worker(local, &normalized_mode)?);
    }

    let pid = slot
        .as_ref()
        .map(|worker| worker.child.id())
        .ok_or_else(|| "Local AI worker did not start.".to_string())?;

    if let Some(task) = task_state {
        task.cancel_requested.store(false, Ordering::SeqCst);
        let mut active_pid = task
            .pid
            .lock()
            .map_err(|_| "Render task state is unavailable.".to_string())?;
        *active_pid = Some(pid);
    }

    {
        let worker = slot
            .as_mut()
            .ok_or_else(|| "Local AI worker is unavailable.".to_string())?;
        writeln!(worker.stdin, "{}", request)
            .map_err(|error| format!("Failed to send request to local AI worker: {error}"))?;
        worker
            .stdin
            .flush()
            .map_err(|error| format!("Failed to flush local AI worker request: {error}"))?;
    }

    loop {
        let mut line = String::new();
        let read = {
            let worker = slot
                .as_mut()
                .ok_or_else(|| "Local AI worker is unavailable.".to_string())?;
            worker
                .stdout
                .read_line(&mut line)
                .map_err(|error| format!("Failed to read local AI worker response: {error}"))?
        };

        if read == 0 {
            let detail = slot
                .as_ref()
                .and_then(|worker| worker.stderr_tail.lock().ok().map(|lines| lines.join("\n")))
                .unwrap_or_default();
            stop_engine_worker(&mut slot);

            if let Some(task) = task_state {
                if let Ok(mut active_pid) = task.pid.lock() {
                    *active_pid = None;
                }
                if task.cancel_requested.swap(false, Ordering::SeqCst) {
                    if let (Some(app), Some(event)) = (app, progress_event) {
                        let _ = app.emit(
                            event,
                            json!({
                                "stage": "cancelled",
                                "progress": 0.0,
                                "message": "Render cancelled"
                            }),
                        );
                    }
                    return Err("Render cancelled.".to_string());
                }
            }

            return Err(if detail.trim().is_empty() {
                "Local AI worker exited unexpectedly.".to_string()
            } else {
                format!("Local AI worker exited unexpectedly.\n{detail}")
            });
        }

        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };

        match value.get("type").and_then(Value::as_str) {
            Some("progress") => {
                if let (Some(app), Some(event), Some(progress)) =
                    (app, progress_event, value.get("result"))
                {
                    let _ = app.emit(event, progress.clone());
                }
            }
            Some("result") => {
                if let Some(task) = task_state {
                    if let Ok(mut active_pid) = task.pid.lock() {
                        *active_pid = None;
                    }
                    task.cancel_requested.store(false, Ordering::SeqCst);
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
            Some("error") => {
                if let Some(task) = task_state {
                    if let Ok(mut active_pid) = task.pid.lock() {
                        *active_pid = None;
                    }
                    task.cancel_requested.store(false, Ordering::SeqCst);
                }
                return Err(
                    value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown local AI worker error")
                        .to_string(),
                );
            }
            _ => {}
        }
    }
}

fn final_engine_message(stdout: &str, stderr: &str) -> Result<Value, String> {
    let mut final_message: Option<Value> = None;

    for line in stdout.lines() {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if matches!(
                value.get("type").and_then(Value::as_str),
                Some("result" | "error")
            ) {
                final_message = Some(value);
            }
        }
    }

    let message = final_message.ok_or_else(|| {
        format!(
            "Engine returned no result. stderr: {}",
            stderr
                .lines()
                .rev()
                .take(12)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        )
    })?;

    if message.get("type").and_then(Value::as_str) == Some("error") {
        return Err(
            message
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Unknown engine error")
                .to_string(),
        );
    }

    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn run_engine_request(local: &Path, request: Value, device_mode: Option<&str>) -> Result<Value, String> {
    ensure_runtime_dirs(local)?;
    let python = engine_python(local)?;
    if !python.exists() {
        return Err(format!(
            "Local engine Python not found: {}. Run local AI setup first.",
            python.display()
        ));
    }

    let mut child = configured_engine_command(&python, local, device_mode)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start local engine: {error}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to open engine stdin".to_string())?;
        writeln!(stdin, "{}", request)
            .map_err(|error| format!("Failed to send engine request: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Local engine failed: {error}"))?;

    final_engine_message(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

fn runtime_status_impl(app: &AppHandle) -> Result<Value, String> {
    let configured = configured_runtime_home(app)?;
    let Some(home) = configured else {
        let default_home = default_runtime_home(app)?;
        return Ok(json!({
            "ready": false,
            "portableReady": false,
            "developmentReady": false,
            "configured": false,
            "needsUpdate": false,
            "schemaVersion": 0,
            "requiredSchemaVersion": REQUIRED_RUNTIME_SCHEMA,
            "dataDir": default_home,
            "message": "VideoMagic will set up its local AI runtime automatically."
        }));
    };

    let portable = portable_python(&home);
    let ffmpeg = local_ffmpeg(&home);
    let status_file = home.join("runtime").join("status.json");
    let installed_schema = if status_file.exists() {
        fs::read_to_string(&status_file)
            .ok()
            .and_then(|content| {
                let content = content.trim_start_matches('\u{feff}');
                serde_json::from_str::<Value>(content).ok()
            })
            .and_then(|value| value.get("schemaVersion").and_then(Value::as_u64))
            .unwrap_or(0)
    } else {
        0
    };
    let schema_current = installed_schema >= REQUIRED_RUNTIME_SCHEMA;
    let engine_ready = runtime_engine_dir(&home).is_some();
    let needs_update = portable.exists()
        && ffmpeg.exists()
        && status_file.exists()
        && (!schema_current || !engine_ready);
    let portable_ready = portable.exists()
        && ffmpeg.exists()
        && status_file.exists()
        && schema_current
        && engine_ready;

    #[cfg(debug_assertions)]
    let development_ready = development_python()?.exists() && command_available("ffmpeg");

    #[cfg(not(debug_assertions))]
    let development_ready = false;

    Ok(json!({
        "ready": portable_ready || development_ready,
        "portableReady": portable_ready,
        "developmentReady": development_ready,
        "configured": true,
        "needsUpdate": needs_update,
        "schemaVersion": installed_schema,
        "requiredSchemaVersion": REQUIRED_RUNTIME_SCHEMA,
        "dataDir": home,
        "python": if portable.exists() { Some(portable) } else { None },
        "ffmpeg": if ffmpeg.exists() { Some(ffmpeg) } else { None },
        "message": if portable_ready {
            "Local AI runtime ready."
        } else if needs_update {
            "Local AI runtime update required."
        } else if development_ready {
            "Development runtime ready."
        } else {
            "Local AI runtime needs setup."
        }
    }))
}

#[tauri::command]
fn runtime_status(app: AppHandle) -> Result<Value, String> {
    runtime_status_impl(&app)
}

#[tauri::command]
fn runtime_diagnostics(app: AppHandle) -> Result<Value, String> {
    let runtime = runtime_status_impl(&app)?;
    let engine = if runtime
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        match configured_runtime_home(&app)? {
            Some(local) => run_engine_request(
                &local,
                json!({
                    "id": "desktop-diagnostics",
                    "method": "doctor",
                    "params": {}
                }),
                None,
            )
            .unwrap_or_else(|error| json!({ "error": error })),
            None => Value::Null,
        }
    } else {
        Value::Null
    };

    Ok(json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": runtime,
        "engine": engine
    }))
}

#[tauri::command]
fn render_history(app: AppHandle) -> Result<Vec<Value>, String> {
    let items = read_render_history(&app)?;
    Ok(items
        .into_iter()
        .map(|mut item| {
            if let Some(path) = item.get("path").and_then(Value::as_str) {
                let exists = Path::new(path).exists();
                if let Some(object) = item.as_object_mut() {
                    object.insert("exists".to_string(), json!(exists));
                }
            }
            item
        })
        .collect())
}

#[tauri::command]
fn remove_render_history(app: AppHandle, id: String) -> Result<bool, String> {
    let mut items = read_render_history(&app)?;
    let before = items.len();
    items.retain(|item| {
        item.get("id")
            .and_then(Value::as_str)
            .map(|value| value != id)
            .unwrap_or(true)
    });
    write_render_history(&app, &items)?;
    Ok(items.len() != before)
}

#[tauri::command]
fn clear_render_history(app: AppHandle) -> Result<bool, String> {
    write_render_history(&app, &[])?;
    Ok(true)
}

#[tauri::command]
fn recent_projects(app: AppHandle) -> Result<Vec<Value>, String> {
    let items = read_recent_projects(&app)?;
    Ok(items
        .into_iter()
        .map(|mut item| {
            if let Some(path) = item.get("path").and_then(Value::as_str) {
                let exists = Path::new(path).exists();
                if let Some(object) = item.as_object_mut() {
                    object.insert("exists".to_string(), json!(exists));
                }
            }
            item
        })
        .collect())
}

#[tauri::command]
fn remove_recent_project(app: AppHandle, path: String) -> Result<bool, String> {
    let mut items = read_recent_projects(&app)?;
    let before = items.len();
    items.retain(|item| {
        item.get("path")
            .and_then(Value::as_str)
            .map(|value| value != path)
            .unwrap_or(true)
    });
    write_recent_projects(&app, &items)?;
    Ok(items.len() != before)
}

#[tauri::command]
fn clear_recent_projects(app: AppHandle) -> Result<bool, String> {
    write_recent_projects(&app, &[])?;
    Ok(true)
}

#[tauri::command]
fn save_project_file(app: AppHandle, path: String, project: Value) -> Result<Value, String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("Project path is empty.".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create project folder: {error}"))?;
    }

    let content = serde_json::to_string_pretty(&project)
        .map_err(|error| format!("Could not serialize project: {error}"))?;
    fs::write(&target, content.as_bytes())
        .map_err(|error| format!("Could not save project: {error}"))?;
    remember_recent_project(&app, &target)?;

    Ok(json!({
        "path": target,
        "saved": true
    }))
}

#[tauri::command]
fn load_project_file(app: AppHandle, path: String) -> Result<Value, String> {
    let target = PathBuf::from(path.trim());
    let content = fs::read_to_string(&target)
        .map_err(|error| format!("Could not read project file: {error}"))?;
    let value = serde_json::from_str::<Value>(&content)
        .map_err(|error| format!("Invalid VideoMagic project file: {error}"))?;
    remember_recent_project(&app, &target)?;

    Ok(json!({
        "path": target,
        "project": value
    }))
}

fn emit_runtime_progress(app: &AppHandle, line: &str) {
    if let Some(rest) = line.strip_prefix("[VideoMagic][") {
        if let Some((stage, message)) = rest.split_once("] ") {
            let progress = match stage {
                "uv" => 0.08,
                "python" => 0.18,
                "torch" => 0.38,
                "vision" => 0.48,
                "engine" => 0.64,
                "ffmpeg" => 0.84,
                "verify" => 0.95,
                "done" => 1.0,
                _ => 0.02,
            };
            let _ = app.emit(
                "videomagic://runtime-progress",
                json!({
                    "stage": stage,
                    "progress": progress,
                    "message": message
                }),
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn bootstrap_runtime_sync(app: &AppHandle, data_dir: String) -> Result<Value, String> {
    let home = PathBuf::from(data_dir.trim());
    if home.as_os_str().is_empty() {
        return Err("Choose a data directory first.".to_string());
    }

    fs::create_dir_all(&home)
        .map_err(|error| format!("Could not create runtime directory: {error}"))?;

    let script = app
        .path()
        .resolve("bootstrap/windows-bootstrap.ps1", BaseDirectory::Resource)
        .map_err(|error| format!("Could not resolve bootstrap script: {error}"))?;
    let engine_dir = app
        .path()
        .resolve("engine", BaseDirectory::Resource)
        .map_err(|error| format!("Could not resolve bundled engine: {error}"))?;

    if !script.exists() {
        return Err(format!("Bootstrap resource missing: {}", script.display()));
    }
    if !engine_dir.exists() {
        return Err(format!("Bundled engine resource missing: {}", engine_dir.display()));
    }

    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .arg("-DataDir")
        .arg(&home)
        .arg("-EngineDir")
        .arg(&engine_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start runtime setup: {error}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture setup stderr".to_string())?;
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_tail_worker = Arc::clone(&stderr_tail);
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut lines) = stderr_tail_worker.lock() {
                lines.push(line);
                if lines.len() > 40 {
                    lines.remove(0);
                }
            }
        }
    });

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture setup stdout".to_string())?;
    let mut stdout_tail = Vec::<String>::new();

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        emit_runtime_progress(app, &line);
        stdout_tail.push(line);
        if stdout_tail.len() > 60 {
            stdout_tail.remove(0);
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Runtime setup process failed: {error}"))?;
    let _ = stderr_thread.join();

    if !status.success() {
        let mut detail = stdout_tail;
        if let Ok(lines) = stderr_tail.lock() {
            detail.extend(lines.iter().cloned());
        }
        return Err(format!(
            "Runtime setup failed.\n{}",
            detail.into_iter().rev().take(30).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        ));
    }

    persist_runtime_home(app, &home)?;
    runtime_status_impl(app)
}

#[tauri::command]
async fn bootstrap_runtime(app: AppHandle, data_dir: String) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            bootstrap_runtime_sync(&app, data_dir)
        })
        .await
        .map_err(|error| format!("Runtime setup task failed: {error}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, data_dir);
        Err("Runtime bootstrap is currently available on Windows only.".to_string())
    }
}

#[tauri::command]
fn allow_preview_file(app: AppHandle, path: String) -> Result<bool, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_file() {
        return Err("Selected preview video does not exist.".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&target)
        .map_err(|error| format!("Could not allow local video preview: {error}"))?;
    Ok(true)
}

#[tauri::command]
async fn probe_video_info(
    app: AppHandle,
    state: State<'_, EngineWorkerState>,
    video_path: String,
    device_mode: String,
) -> Result<Value, String> {
    let engine_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        run_persistent_engine_request(
            None,
            &engine_state,
            None,
            &local,
            json!({
                "id": "desktop-probe-video",
                "method": "probe_video",
                "params": {
                    "videoPath": video_path
                }
            }),
            device_mode.as_str(),
            None,
        )
    })
    .await
    .map_err(|error| format!("Video probe task failed: {error}"))?
}

#[tauri::command]
async fn video_waveform(
    app: AppHandle,
    state: State<'_, EngineWorkerState>,
    video_path: String,
    points: Option<u32>,
    device_mode: String,
) -> Result<Value, String> {
    let engine_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        run_persistent_engine_request(
            None,
            &engine_state,
            None,
            &local,
            json!({
                "id": "desktop-waveform",
                "method": "waveform",
                "params": {
                    "videoPath": video_path,
                    "points": points.unwrap_or(240)
                }
            }),
            device_mode.as_str(),
            None,
        )
    })
    .await
    .map_err(|error| format!("Waveform task failed: {error}"))?
}

#[tauri::command]
async fn analyze_video(
    app: AppHandle,
    task: State<'_, RenderTaskState>,
    state: State<'_, EngineWorkerState>,
    video_path: String,
    vision_mode: String,
    device_mode: String,
) -> Result<Value, String> {
    let task_state = task.inner().clone();
    let engine_state = state.inner().clone();
    let app_for_worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app_for_worker)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        run_persistent_engine_request(
            Some(&app_for_worker),
            &engine_state,
            Some(&task_state),
            &local,
            json!({
                "id": "desktop-analyze-video",
                "method": "analyze_video",
                "params": {
                    "videoPath": video_path,
                    "visionMode": vision_mode
                }
            }),
            device_mode.as_str(),
            Some("videomagic://analysis-progress"),
        )
    })
    .await
    .map_err(|error| format!("Video analysis task failed: {error}"))?
}

#[tauri::command]
async fn plan_ai_edit(
    app: AppHandle,
    state: State<'_, EngineWorkerState>,
    scenes: Value,
    instruction: String,
    vision_mode: String,
    device_mode: String,
) -> Result<Value, String> {
    let engine_state = state.inner().clone();
    let app_for_worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app_for_worker)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        run_persistent_engine_request(
            Some(&app_for_worker),
            &engine_state,
            None,
            &local,
            json!({
                "id": "desktop-plan-ai-edit",
                "method": "plan_edit",
                "params": {
                    "scenes": scenes,
                    "instruction": instruction,
                    "visionMode": vision_mode
                }
            }),
            device_mode.as_str(),
            Some("videomagic://ai-edit-progress"),
        )
    })
    .await
    .map_err(|error| format!("AI edit planning failed: {error}"))?
}

#[tauri::command]
async fn render_ai_edit(
    app: AppHandle,
    task: State<'_, RenderTaskState>,
    engine: State<'_, EngineWorkerState>,
    video_path: String,
    scenes: Option<Value>,
    instruction: String,
    vision_mode: String,
    device_mode: String,
    output_dir: Option<String>,
) -> Result<Value, String> {
    let task_state = task.inner().clone();
    let engine_state = engine.inner().clone();
    let app_for_worker = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app_for_worker)?
            .ok_or_else(|| "Local AI runtime is not configured. Run setup first.".to_string())?;
        ensure_runtime_dirs(&local)?;
        let output_path = make_output_path(&local, &video_path, output_dir)?;

        run_persistent_engine_request(
            Some(&app_for_worker),
            &engine_state,
            Some(&task_state),
            &local,
            json!({
                "id": "desktop-ai-edit",
                "method": "ai_edit",
                "params": {
                    "videoPath": video_path,
                    "scenes": scenes,
                    "instruction": instruction,
                    "visionMode": vision_mode,
                    "outputPath": output_path
                }
            }),
            device_mode.as_str(),
            Some("videomagic://ai-edit-progress"),
        )
    })
    .await
    .map_err(|error| format!("AI edit task failed: {error}"))?
}

#[tauri::command]
async fn plan_narration_timeline(
    app: AppHandle,
    state: State<'_, EngineWorkerState>,
    text: String,
    target_duration: f64,
    device_mode: String,
) -> Result<Value, String> {
    let engine_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        run_persistent_engine_request(
            None,
            &engine_state,
            None,
            &local,
            json!({
                "id": "desktop-plan-timeline",
                "method": "plan_timeline",
                "params": {
                    "text": text,
                    "targetDuration": target_duration
                }
            }),
            device_mode.as_str(),
            None,
        )
    })
    .await
    .map_err(|error| format!("Timeline planning task failed: {error}"))?
}

#[tauri::command]
async fn preview_voice(
    app: AppHandle,
    state: State<'_, EngineWorkerState>,
    voice: String,
    speed: f64,
    text: String,
    device_mode: String,
) -> Result<Value, String> {
    let engine_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = configured_runtime_home(&app)?
            .ok_or_else(|| "Local AI runtime is not configured.".to_string())?;
        let preview_text = {
            let clean = text.trim();
            if clean.is_empty() {
                if voice.starts_with('a') || voice.starts_with('b') {
                    "Hi, this is VideoMagic. Your local AI voice is ready.".to_string()
                } else {
                    "你好，这里是 VideoMagic。本地 AI 配音已经准备好了。".to_string()
                }
            } else {
                clean.chars().take(88).collect::<String>()
            }
        };
        let preview_path = local
            .join("previews")
            .join(format!("{voice}-preview.wav"));

        let result = run_persistent_engine_request(
            None,
            &engine_state,
            None,
            &local,
            json!({
                "id": "desktop-preview",
                "method": "synthesize",
                "params": {
                    "text": preview_text,
                    "voice": voice,
                    "speed": speed,
                    "outputPath": preview_path
                }
            }),
            device_mode.as_str(),
            None,
        )?;

        let path = result
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Preview did not return an audio path.".to_string())?;
        let bytes = fs::read(path)
            .map_err(|error| format!("Could not read preview audio: {error}"))?;
        Ok(json!({
            "audioDataUrl": format!("data:audio/wav;base64,{}", BASE64_STANDARD.encode(bytes)),
            "meta": result
        }))
    })
    .await
    .map_err(|error| format!("Voice preview task failed: {error}"))?
}

fn make_output_path(local: &Path, video_path: &str, output_dir: Option<String>) -> Result<PathBuf, String> {
    let target_dir = output_dir
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| local.join("exports"));
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create output directory: {error}"))?;

    let stem = Path::new(video_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("video");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_secs();

    Ok(target_dir.join(format!("{stem}-videomagic-{stamp}.mp4")))
}

fn render_video_sync(
    app: AppHandle,
    task_state: RenderTaskState,
    engine_state: EngineWorkerState,
    video_path: String,
    text: String,
    voice: String,
    speed: f64,
    original_volume: f64,
    output_dir: Option<String>,
    ducking: bool,
    auto_timing: bool,
    subtitles: bool,
    device_mode: String,
    timeline: Option<Value>,
) -> Result<Value, String> {
    let local = configured_runtime_home(&app)?
        .ok_or_else(|| "Local AI runtime is not configured. Run setup first.".to_string())?;
    ensure_runtime_dirs(&local)?;

    let output_path = make_output_path(&local, &video_path, output_dir)?;
    let history_source_video = video_path.clone();
    let history_voice = voice.clone();
    let history_device_mode = device_mode.clone();
    let request = json!({
        "id": "desktop-render",
        "method": "render",
        "params": {
            "videoPath": video_path,
            "text": text,
            "voice": voice,
            "speed": speed,
            "originalVolume": original_volume,
            "ducking": ducking,
            "autoTiming": auto_timing,
            "subtitles": subtitles,
            "timeline": timeline,
            "outputPath": output_path
        }
    });

    let result = run_persistent_engine_request(
        Some(&app),
        &engine_state,
        Some(&task_state),
        &local,
        request,
        device_mode.as_str(),
        Some("videomagic://render-progress"),
    )?;

    remember_render(
        &app,
        &history_source_video,
        &result,
        &history_voice,
        speed,
        original_volume,
        ducking,
        auto_timing,
        subtitles,
        &history_device_mode,
    )?;
    Ok(result)
}

#[tauri::command]
async fn render_video(
    app: AppHandle,
    state: State<'_, RenderTaskState>,
    engine: State<'_, EngineWorkerState>,
    video_path: String,
    text: String,
    voice: String,
    speed: f64,
    original_volume: f64,
    output_dir: Option<String>,
    ducking: bool,
    auto_timing: bool,
    subtitles: bool,
    device_mode: String,
    timeline: Option<Value>,
) -> Result<Value, String> {
    let task_state = state.inner().clone();
    let engine_state = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        render_video_sync(
            app,
            task_state,
            engine_state,
            video_path,
            text,
            voice,
            speed,
            original_volume,
            output_dir,
            ducking,
            auto_timing,
            subtitles,
            device_mode,
            timeline,
        )
    })
    .await
    .map_err(|error| format!("Render task failed: {error}"))?
}

#[tauri::command]
fn cancel_render(state: State<'_, RenderTaskState>) -> Result<bool, String> {
    let pid = state
        .pid
        .lock()
        .map_err(|_| "Render task state is unavailable.".to_string())?
        .to_owned();

    let Some(pid) = pid else {
        return Ok(false);
    };

    state.cancel_requested.store(true, Ordering::SeqCst);

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("Failed to cancel render: {error}"))?;
        return Ok(status.success());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| format!("Failed to cancel render: {error}"))?;
        Ok(status.success())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RenderTaskState::default())
        .manage(EngineWorkerState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let worker_state = {
                    let state = window.state::<EngineWorkerState>();
                    Arc::clone(&state.worker)
                };
                if let Ok(mut worker) = worker_state.lock() {
                    stop_engine_worker(&mut worker);
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            runtime_diagnostics,
            render_history,
            remove_render_history,
            clear_render_history,
            recent_projects,
            remove_recent_project,
            clear_recent_projects,
            save_project_file,
            load_project_file,
            bootstrap_runtime,
            allow_preview_file,
            probe_video_info,
            video_waveform,
            analyze_video,
            plan_ai_edit,
            render_ai_edit,
            plan_narration_timeline,
            preview_voice,
            render_video,
            cancel_render
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
