use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{path::BaseDirectory, AppHandle, Manager};

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

fn configured_runtime_home(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if let Some(path) = env::var_os("VIDEOMAGIC_HOME") {
        return Ok(Some(PathBuf::from(path)));
    }

    let config = runtime_config_path(app)?;
    if config.exists() {
        let value = fs::read_to_string(&config)
            .map_err(|error| format!("Could not read runtime location: {error}"))?;
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Some(PathBuf::from(trimmed)));
        }
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

fn runtime_status_impl(app: &AppHandle) -> Result<Value, String> {
    let configured = configured_runtime_home(app)?;
    let Some(home) = configured else {
        return Ok(json!({
            "ready": false,
            "portableReady": false,
            "developmentReady": false,
            "configured": false,
            "dataDir": Value::Null,
            "message": "Choose a data folder to install the local AI runtime."
        }));
    };

    let portable = portable_python(&home);
    let ffmpeg = local_ffmpeg(&home);
    let status_file = home.join("runtime").join("status.json");
    let portable_ready = portable.exists() && ffmpeg.exists() && status_file.exists();

    #[cfg(debug_assertions)]
    let development_ready = development_python()?.exists() && command_available("ffmpeg");

    #[cfg(not(debug_assertions))]
    let development_ready = false;

    Ok(json!({
        "ready": portable_ready || development_ready,
        "portableReady": portable_ready,
        "developmentReady": development_ready,
        "configured": true,
        "dataDir": home,
        "python": if portable.exists() { Some(portable) } else { None },
        "ffmpeg": if ffmpeg.exists() { Some(ffmpeg) } else { None },
        "message": if portable_ready {
            "Local AI runtime ready."
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

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-DataDir")
        .arg(&home)
        .arg("-EngineDir")
        .arg(&engine_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to start runtime setup: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let detail = stdout
            .lines()
            .chain(stderr.lines())
            .rev()
            .take(24)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("Runtime setup failed.\n{detail}"));
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
fn render_video(
    app: AppHandle,
    video_path: String,
    text: String,
    voice: String,
    speed: f64,
    original_volume: f64,
) -> Result<Value, String> {
    let local = configured_runtime_home(&app)?
        .ok_or_else(|| "Local AI runtime is not configured. Run setup first.".to_string())?;
    let python = engine_python(&local)?;

    if !python.exists() {
        return Err(format!(
            "Local engine Python not found: {}. Run local AI setup first.",
            python.display()
        ));
    }

    for relative in [
        "cache/huggingface",
        "cache/torch",
        "cache/pycache",
        "tmp",
        "outputs",
        "exports",
    ] {
        fs::create_dir_all(local.join(relative))
            .map_err(|error| format!("Failed to create local runtime directory: {error}"))?;
    }

    let request = json!({
        "id": "desktop-render",
        "method": "render",
        "params": {
            "videoPath": video_path,
            "text": text,
            "voice": voice,
            "speed": speed,
            "originalVolume": original_volume
        }
    });

    let ffmpeg_bin = local.join("tools").join("ffmpeg").join("bin");
    let path_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let path_env = format!(
        "{}{}{}",
        ffmpeg_bin.display(),
        path_separator,
        env::var("PATH").unwrap_or_default()
    );

    let mut child = Command::new(&python)
        .args(["-m", "videomagic_engine.main"])
        .env("VIDEOMAGIC_HOME", &local)
        .env("HF_HOME", local.join("cache").join("huggingface"))
        .env("TORCH_HOME", local.join("cache").join("torch"))
        .env("PYTHONPYCACHEPREFIX", local.join("cache").join("pycache"))
        .env("TMP", local.join("tmp"))
        .env("TEMP", local.join("tmp"))
        .env("PATH", path_env)
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
            .map_err(|error| format!("Failed to send render request: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Local engine failed: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
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
                .take(8)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            bootstrap_runtime,
            render_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
