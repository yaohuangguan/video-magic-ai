param(
    [Parameter(Mandatory = $true)]
    [string]$DataDir,

    [Parameter(Mandatory = $true)]
    [string]$EngineDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Stage, [string]$Message) {
    Write-Output ("[VideoMagic][" + $Stage + "] " + $Message)
}

function Ensure-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

$downloads = Join-Path $DataDir "downloads"
$tools = Join-Path $DataDir "tools"
$cache = Join-Path $DataDir "cache"
$tmp = Join-Path $DataDir "tmp"
$runtime = Join-Path $DataDir "runtime"
$uvDir = Join-Path $tools "uv"
$uvExe = Join-Path $uvDir "uv.exe"
$venvDir = Join-Path $runtime "venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$ffmpegBin = Join-Path $tools "ffmpeg\bin"
$ffmpegExe = Join-Path $ffmpegBin "ffmpeg.exe"
$ffprobeExe = Join-Path $ffmpegBin "ffprobe.exe"

@(
    $DataDir,
    $downloads,
    $tools,
    $cache,
    $tmp,
    $runtime,
    $uvDir,
    $ffmpegBin,
    (Join-Path $cache "pip"),
    (Join-Path $cache "uv"),
    (Join-Path $cache "huggingface"),
    (Join-Path $cache "torch"),
    (Join-Path $cache "pycache"),
    (Join-Path $DataDir "outputs"),
    (Join-Path $DataDir "exports")
) | ForEach-Object { Ensure-Directory $_ }

$env:TEMP = $tmp
$env:TMP = $tmp
$env:TMPDIR = $tmp
$env:PIP_CACHE_DIR = Join-Path $cache "pip"
$env:HF_HOME = Join-Path $cache "huggingface"
$env:TORCH_HOME = Join-Path $cache "torch"
$env:PYTHONPYCACHEPREFIX = Join-Path $cache "pycache"
$env:UV_CACHE_DIR = Join-Path $cache "uv"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtime "python"
$env:UV_PYTHON_BIN_DIR = Join-Path $runtime "python-bin"

if (-not (Test-Path $uvExe)) {
    Write-Step "uv" "Downloading local Python runtime manager"
    $uvZip = Join-Path $downloads "uv-windows-x64.zip"
    $uvStage = Join-Path $tmp "uv-expand"
    Remove-Item -Recurse -Force $uvStage -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" -OutFile $uvZip -UseBasicParsing
    Expand-Archive -Force $uvZip $uvStage
    $downloadedUv = Get-ChildItem $uvStage -Recurse -Filter "uv.exe" | Select-Object -First 1
    if (-not $downloadedUv) {
        throw "uv.exe was not found in downloaded archive"
    }
    Copy-Item -Force $downloadedUv.FullName $uvExe
    Remove-Item -Recurse -Force $uvStage -ErrorAction SilentlyContinue
    Remove-Item -Force $uvZip -ErrorAction SilentlyContinue
}

if (-not (Test-Path $pythonExe)) {
    Write-Step "python" "Installing managed Python 3.11 into VideoMagic data directory"
    & $uvExe python install 3.11
    if ($LASTEXITCODE -ne 0) {
        throw "uv failed to install Python 3.11"
    }

    & $uvExe venv --seed --python 3.11 $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "uv failed to create VideoMagic runtime environment"
    }
}

Write-Step "python" ("Using " + $pythonExe)

$torchReady = & $pythonExe -c "import importlib.util; print('1' if importlib.util.find_spec('torch') else '0')"
if ($torchReady.Trim() -ne "1") {
    $hasNvidia = $null -ne (Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue)
    $torchIndex = if ($hasNvidia) {
        "https://download.pytorch.org/whl/cu128"
    } else {
        "https://download.pytorch.org/whl/cpu"
    }

    Write-Step "torch" ("Installing PyTorch from " + $torchIndex)
    & $pythonExe -m pip install torch torchvision --index-url $torchIndex
    if ($LASTEXITCODE -ne 0) {
        throw "PyTorch / torchvision installation failed"
    }
} else {
    $visionTorchReady = & $pythonExe -c "import importlib.util; print('1' if importlib.util.find_spec('torchvision') else '0')"
    if ($visionTorchReady.Trim() -ne "1") {
        $hasNvidia = $null -ne (Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue)
        $torchIndex = if ($hasNvidia) {
            "https://download.pytorch.org/whl/cu128"
        } else {
            "https://download.pytorch.org/whl/cpu"
        }
        Write-Step "vision" "Installing torchvision for local video understanding"
        & $pythonExe -m pip install torchvision --index-url $torchIndex
        if ($LASTEXITCODE -ne 0) {
            throw "torchvision installation failed"
        }
    }
}

Write-Step "engine" "Installing VideoMagic local AI engine"
& $pythonExe -m pip install --upgrade $EngineDir
if ($LASTEXITCODE -ne 0) {
    throw "VideoMagic engine installation failed"
}

if (-not (Test-Path $ffmpegExe) -or -not (Test-Path $ffprobeExe)) {
    Write-Step "ffmpeg" "Downloading local FFmpeg tools"
    $ffmpegZip = Join-Path $downloads "ffmpeg-release-essentials.zip"
    $ffmpegStage = Join-Path $tmp "ffmpeg-expand"
    Remove-Item -Recurse -Force $ffmpegStage -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip -UseBasicParsing
    Expand-Archive -Force $ffmpegZip $ffmpegStage

    $downloadedFfmpeg = Get-ChildItem $ffmpegStage -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    $downloadedFfprobe = Get-ChildItem $ffmpegStage -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
    if (-not $downloadedFfmpeg -or -not $downloadedFfprobe) {
        throw "FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe"
    }

    Copy-Item -Force $downloadedFfmpeg.FullName $ffmpegExe
    Copy-Item -Force $downloadedFfprobe.FullName $ffprobeExe
    Remove-Item -Recurse -Force $ffmpegStage -ErrorAction SilentlyContinue
    Remove-Item -Force $ffmpegZip -ErrorAction SilentlyContinue
}

$env:PATH = $ffmpegBin + ";" + $env:PATH
$env:VIDEOMAGIC_HOME = $DataDir

Write-Step "verify" "Checking local runtime"
$verify = & $pythonExe -c "import json, importlib.util, torch; print(json.dumps({'torch': torch.__version__, 'cuda': bool(torch.cuda.is_available()), 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, 'kokoro': bool(importlib.util.find_spec('kokoro')), 'misaki': bool(importlib.util.find_spec('misaki')), 'transformers': bool(importlib.util.find_spec('transformers')), 'torchvision': bool(importlib.util.find_spec('torchvision')), 'av': bool(importlib.util.find_spec('av'))}))"
if ($LASTEXITCODE -ne 0) {
    throw "Runtime verification failed"
}

$status = [ordered]@{
    ready = $true
    python = $pythonExe
    ffmpeg = $ffmpegExe
    ffprobe = $ffprobeExe
    engineDir = $EngineDir
    verification = ($verify | Select-Object -Last 1)
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $runtime "status.json")
Write-Step "done" "VideoMagic local runtime is ready"
$status | ConvertTo-Json -Compress -Depth 4
