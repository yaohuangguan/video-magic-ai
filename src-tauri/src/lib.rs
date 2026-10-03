use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve VideoMagic project root".to_string())
}

fn runtime_home(root: &Path) -> PathBuf {
    if let Some(path) = env::var_os("VIDEOMAGIC_HOME") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "windows")]
    if let Some(parent) = root.parent() {
        return parent.join("videomagic-data");
    }

    root.join(".local")
}

fn engine_python(root: &Path) -> PathBuf {
    if let Some(path) = env::var_os("VIDEOMAGIC_ENGINE_PYTHON") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "windows")]
    {
        return root
            .join("engine")
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
    }

    #[cfg(not(target_os = "windows"))]
    {
        root.join("engine").join(".venv").join("bin").join("python")
    }
}

#[tauri::command]
fn render_video(
    video_path: String,
    text: String,
    voice: String,
    speed: f64,
    original_volume: f64,
) -> Result<Value, String> {
    let root = project_root()?;

    let python = engine_python(&root);

    if !python.exists() {
        return Err(format!("Local engine Python not found: {}", python.display()));
    }

    let local = runtime_home(&root);
    for relative in [
        "cache/huggingface",
        "cache/torch",
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

    let mut child = Command::new(&python)
        .args(["-m", "videomagic_engine.main"])
        .env("VIDEOMAGIC_HOME", &local)
        .env("HF_HOME", local.join("cache").join("huggingface"))
        .env("TORCH_HOME", local.join("cache").join("torch"))
        .env("TMP", local.join("tmp"))
        .env("TEMP", local.join("tmp"))
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
            if matches!(value.get("type").and_then(Value::as_str), Some("result" | "error")) {
                final_message = Some(value);
            }
        }
    }

    let message = final_message.ok_or_else(|| {
        format!(
            "Engine returned no result. stderr: {}",
            stderr.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
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
        .invoke_handler(tauri::generate_handler![render_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
