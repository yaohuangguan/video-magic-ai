import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import "./app.css";

type VoicePreset = {
  id: string;
  name: string;
  description: string;
  tag: string;
};

type InferenceMode = "auto" | "cuda" | "cpu";

type RecentProject = {
  path: string;
  name: string;
  lastOpened: number;
  exists: boolean;
};

type RenderHistoryItem = {
  id: string;
  path: string;
  name: string;
  sourceVideo: string;
  createdAt: number;
  exists: boolean;
  durationSeconds?: number | null;
  voice: string;
  speed: number;
  originalVolume: number;
  ducking: boolean;
  autoTiming: boolean;
  subtitles: boolean;
  deviceMode: InferenceMode;
  narrationPath?: string | null;
  subtitlePath?: string | null;
};

type CreatorPreset = {
  id: string;
  name: string;
  voice: string;
  speed: number;
  originalVolume: number;
  ducking: boolean;
  autoTiming: boolean;
  subtitles: boolean;
  custom?: boolean;
};

type RenderResult = {
  narrationPath?: string;
  video?: {
    path?: string;
    videoDurationSeconds?: number;
    ducking?: boolean;
  };
};

type RuntimeStatus = {
  ready: boolean;
  portableReady: boolean;
  developmentReady: boolean;
  configured: boolean;
  dataDir?: string | null;
  message?: string;
};

type RuntimeDiagnostics = {
  appVersion: string;
  platform: string;
  arch: string;
  runtime: RuntimeStatus;
  engine?: {
    engineVersion?: string;
    python?: string;
    ffmpeg?: string | null;
    ffprobe?: string | null;
    kokoroInstalled?: boolean;
    videomagicHome?: string | null;
    error?: string;
    gpu?: {
      cudaAvailable?: boolean;
      device?: string | null;
      torchVersion?: string;
      error?: string;
    };
  } | null;
};

type TaskProgress = {
  stage: string;
  progress: number;
  message: string;
};

type PreviewResult = {
  audioDataUrl: string;
  meta?: {
    durationSeconds?: number;
    device?: string;
  };
};

type ProjectFileResult = {
  path: string;
  project: SavedProject;
};

type SavedProject = {
  schemaVersion: 1;
  videoPath: string;
  script: string;
  voice: string;
  speed: number;
  originalVolume: number;
  ducking: boolean;
  autoTiming: boolean;
  subtitles: boolean;
  outputDir: string;
  deviceMode: InferenceMode;
};

const PROJECT_STORAGE_KEY = "videomagic.project.v1";
const PRESET_STORAGE_KEY = "videomagic.creator-presets.v1";

const builtinPresets: CreatorPreset[] = [
  {
    id: "short-form",
    name: "Short-form punchy",
    voice: "zm_009",
    speed: 1.15,
    originalVolume: 34,
    ducking: true,
    autoTiming: true,
    subtitles: true,
  },
  {
    id: "storytelling",
    name: "Storytelling",
    voice: "zm_010",
    speed: 1.0,
    originalVolume: 42,
    ducking: true,
    autoTiming: true,
    subtitles: true,
  },
  {
    id: "documentary",
    name: "Documentary",
    voice: "zm_011",
    speed: 0.95,
    originalVolume: 48,
    ducking: true,
    autoTiming: true,
    subtitles: true,
  },
];

const voices: VoicePreset[] = [
  { id: "zm_009", name: "Punchy Male", description: "Sharper pacing for commentary and short-form clips.", tag: "Fast" },
  { id: "zm_010", name: "Story Male", description: "Natural Mandarin narration with a balanced tone.", tag: "Story" },
  { id: "zm_011", name: "Deep Male", description: "Steadier voice for explainers and documentary content.", tag: "Deep" },
  { id: "zf_001", name: "Bright Female", description: "Clear, lighter delivery for lifestyle and social clips.", tag: "Bright" },
];

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function parentDirectory(path: string) {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("\\");
}

function dataDirectory(parent: string) {
  return parent.replace(/[\\/]+$/, "") + "\\VideoMagicData";
}

function App() {
  const [videoPath, setVideoPath] = useState("");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(voices[1].id);
  const [speed, setSpeed] = useState(1.05);
  const [originalVolume, setOriginalVolume] = useState(42);
  const [ducking, setDucking] = useState(true);
  const [autoTiming, setAutoTiming] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [outputDir, setOutputDir] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [engineWarm, setEngineWarm] = useState(false);

  const [status, setStatus] = useState("Ready");
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState("idle");
  const [runtimeProgress, setRuntimeProgress] = useState(0);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [projectFilePath, setProjectFilePath] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [showRecentProjects, setShowRecentProjects] = useState(false);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [customPresets, setCustomPresets] = useState<CreatorPreset[]>([]);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [deviceMode, setDeviceMode] = useState<InferenceMode>("auto");
  const [showSettings, setShowSettings] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const projectHydrated = useRef(false);

  const canGenerate = Boolean(
    runtime?.ready &&
      videoPath &&
      script.trim().length > 0 &&
      !isGenerating &&
      !isBootstrapping,
  );

  async function refreshRuntime() {
    try {
      const result = await invoke<RuntimeStatus>("runtime_status");
      setRuntime(result);
      if (result.dataDir) {
        setOutputDir((current) => current || result.dataDir + "\\exports");
      }
    } catch (error) {
      setRuntime({
        ready: false,
        portableReady: false,
        developmentReady: false,
        configured: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function refreshDiagnostics() {
    setIsLoadingDiagnostics(true);
    try {
      const result = await invoke<RuntimeDiagnostics>("runtime_diagnostics");
      setDiagnostics(result);
    } catch (error) {
      setDiagnostics({
        appVersion: "0.1.0",
        platform: "unknown",
        arch: "unknown",
        runtime: runtime ?? {
          ready: false,
          portableReady: false,
          developmentReady: false,
          configured: false,
        },
        engine: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      setIsLoadingDiagnostics(false);
    }
  }

  async function openSettings() {
    setShowSettings(true);
    setDiagnosticsCopied(false);
    await refreshDiagnostics();
  }

  async function copyDiagnostics() {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshRecentProjects() {
    try {
      const items = await invoke<RecentProject[]>("recent_projects");
      setRecentProjects(items);
    } catch {
      setRecentProjects([]);
    }
  }

  async function refreshRenderHistory() {
    try {
      const items = await invoke<RenderHistoryItem[]>("render_history");
      setRenderHistory(items);
    } catch {
      setRenderHistory([]);
    }
  }

  useEffect(() => {
    void refreshRuntime();
    void refreshRecentProjects();
    void refreshRenderHistory();

    let disposed = false;
    const cleanups: Array<() => void> = [];

    void listen<TaskProgress>("videomagic://render-progress", (event) => {
      if (disposed) return;
      setRenderStage(event.payload.stage);
      setRenderProgress(event.payload.progress);
      setStatus(event.payload.message);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });

    void listen<TaskProgress>("videomagic://runtime-progress", (event) => {
      if (disposed) return;
      setRuntimeProgress(event.payload.progress);
      setRuntimeMessage(event.payload.message);
      setStatus(event.payload.message);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      previewAudio.current?.pause();
    };
  }, []);

  useEffect(() => {
    setEngineWarm(false);
  }, [deviceMode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedProject>;
        if (typeof saved.videoPath === "string") setVideoPath(saved.videoPath);
        if (typeof saved.script === "string") setScript(saved.script);
        if (typeof saved.voice === "string" && voices.some((item) => item.id === saved.voice)) {
          setVoice(saved.voice);
        }
        if (typeof saved.speed === "number") setSpeed(saved.speed);
        if (typeof saved.originalVolume === "number") setOriginalVolume(saved.originalVolume);
        if (typeof saved.ducking === "boolean") setDucking(saved.ducking);
        if (typeof saved.autoTiming === "boolean") setAutoTiming(saved.autoTiming);
        if (typeof saved.subtitles === "boolean") setSubtitles(saved.subtitles);
        if (typeof saved.outputDir === "string") setOutputDir(saved.outputDir);
        if (saved.deviceMode === "auto" || saved.deviceMode === "cuda" || saved.deviceMode === "cpu") {
          setDeviceMode(saved.deviceMode);
        }
      }
    } catch {
      localStorage.removeItem(PROJECT_STORAGE_KEY);
    } finally {
      projectHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CreatorPreset[];
      if (Array.isArray(parsed)) {
        setCustomPresets(parsed.filter((item) => item && item.custom));
      }
    } catch {
      localStorage.removeItem(PRESET_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(customPresets));
  }, [customPresets]);

  useEffect(() => {
    if (!projectHydrated.current) return;

    const timer = window.setTimeout(() => {
      const snapshot: SavedProject = {
        schemaVersion: 1,
        videoPath,
        script,
        voice,
        speed,
        originalVolume,
        ducking,
        autoTiming,
        subtitles,
        outputDir,
        deviceMode,
      };
      localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(snapshot));
      setLastSavedAt(Date.now());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    videoPath,
    script,
    voice,
    speed,
    originalVolume,
    ducking,
    autoTiming,
    subtitles,
    outputDir,
    deviceMode,
  ]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragging(true);
          }
          if (event.payload.type === "leave") {
            setIsDragging(false);
          }
          if (event.payload.type === "drop") {
            setIsDragging(false);
            const path = event.payload.paths.find((item) =>
              /\.(mp4|mov|mkv|webm|m4v)$/i.test(item),
            );
            if (path) {
              setVideoPath(path);
              setOutputPath("");
              setRenderProgress(0);
              setRenderStage("idle");
              setStatus("Video ready");
            }
          }
        }),
      )
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanup = unlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  async function setupRuntime(repairExisting = false) {
    let target = repairExisting && runtime?.dataDir ? runtime.dataDir : "";

    if (!target) {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Choose where VideoMagic AI data should live",
      });

      if (typeof selected !== "string") return;
      target = dataDirectory(selected);
    }
    setIsBootstrapping(true);
    setRuntimeProgress(0.02);
    setRuntimeMessage("Preparing local AI runtime");
    setStatus("Preparing local AI runtime");

    try {
      const result = await invoke<RuntimeStatus>("bootstrap_runtime", {
        dataDir: target,
      });
      setRuntime(result);
      setOutputDir(target + "\\exports");
      setRuntimeProgress(1);
      setRuntimeMessage("Local AI runtime ready");
      setStatus("Local AI runtime ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      await refreshRuntime();
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function chooseVideo() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mov", "mkv", "webm", "m4v"],
        },
      ],
    });

    if (typeof selected === "string") {
      setVideoPath(selected);
      setOutputPath("");
      setRenderProgress(0);
      setRenderStage("idle");
      setStatus("Video ready");
    }
  }

  async function chooseOutputDir() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Choose export folder",
    });

    if (typeof selected === "string") {
      setOutputDir(selected);
    }
  }

  async function previewSelectedVoice() {
    if (!runtime?.ready || isPreviewing) return;

    previewAudio.current?.pause();
    setIsPreviewing(true);
    setStatus("Generating voice preview…");

    try {
      const result = await invoke<PreviewResult>("preview_voice", {
        voice,
        speed,
        text: script.trim(),
        deviceMode,
      });
      const audio = new Audio(result.audioDataUrl);
      previewAudio.current = audio;
      audio.onended = () => setIsPreviewing(false);
      audio.onerror = () => setIsPreviewing(false);
      await audio.play();
      setEngineWarm(true);
      setStatus(
        result.meta?.device
          ? "Preview playing on " + result.meta.device
          : "Preview playing",
      );
    } catch (error) {
      setIsPreviewing(false);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelRender() {
    setStatus("Cancelling render…");
    try {
      await invoke<boolean>("cancel_render");
      setEngineWarm(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function generate() {
    if (!canGenerate) return;

    setIsGenerating(true);
    setOutputPath("");
    setRenderProgress(0.02);
    setRenderStage("starting");
    setStatus("Starting local render…");

    try {
      const result = await invoke<RenderResult>("render_video", {
        videoPath,
        text: script.trim(),
        voice,
        speed,
        originalVolume: originalVolume / 100,
        outputDir: outputDir || null,
        ducking,
        autoTiming,
        subtitles,
        deviceMode,
      });

      const rendered = result.video?.path ?? "";
      setOutputPath(rendered);
      setRenderProgress(1);
      setRenderStage("done");
      setEngineWarm(true);
      setStatus(rendered ? "Video ready" : "Render completed");
      await refreshRenderHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("cancel")) {
        setRenderStage("cancelled");
        setRenderProgress(0);
        setStatus("Render cancelled");
      } else {
        setRenderStage("error");
        setStatus(message);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  async function showOutput() {
    if (outputPath) {
      await openPath(parentDirectory(outputPath));
      return;
    }
    if (outputDir) {
      await openPath(outputDir);
    }
  }

  async function openRenderFile(item: RenderHistoryItem) {
    if (!item.exists) {
      setStatus("Export file no longer exists");
      await refreshRenderHistory();
      return;
    }
    await openPath(item.path);
  }

  async function showRenderInFolder(item: RenderHistoryItem) {
    if (!item.exists) {
      setStatus("Export file no longer exists");
      await refreshRenderHistory();
      return;
    }
    await openPath(parentDirectory(item.path));
  }

  function reuseRenderSettings(item: RenderHistoryItem) {
    if (voices.some((candidate) => candidate.id === item.voice)) {
      setVoice(item.voice);
    }
    setSpeed(item.speed);
    setOriginalVolume(Math.round(item.originalVolume * 100));
    setDucking(item.ducking);
    setAutoTiming(item.autoTiming);
    setSubtitles(item.subtitles);
    setDeviceMode(item.deviceMode);
    setStatus("Render settings restored");
  }

  async function removeRenderHistory(id: string) {
    await invoke<boolean>("remove_render_history", { id });
    await refreshRenderHistory();
  }

  async function clearRenderHistory() {
    await invoke<boolean>("clear_render_history");
    setRenderHistory([]);
  }

  function projectSnapshot(): SavedProject {
    return {
      schemaVersion: 1,
      videoPath,
      script,
      voice,
      speed,
      originalVolume,
      ducking,
      autoTiming,
      subtitles,
      outputDir,
      deviceMode,
    };
  }

  function applyProject(project: Partial<SavedProject>) {
    setVideoPath(typeof project.videoPath === "string" ? project.videoPath : "");
    setScript(typeof project.script === "string" ? project.script : "");
    if (typeof project.voice === "string" && voices.some((item) => item.id === project.voice)) {
      setVoice(project.voice);
    }
    if (typeof project.speed === "number") setSpeed(project.speed);
    if (typeof project.originalVolume === "number") setOriginalVolume(project.originalVolume);
    if (typeof project.ducking === "boolean") setDucking(project.ducking);
    if (typeof project.autoTiming === "boolean") setAutoTiming(project.autoTiming);
    if (typeof project.subtitles === "boolean") setSubtitles(project.subtitles);
    if (typeof project.outputDir === "string") setOutputDir(project.outputDir);
    if (project.deviceMode === "auto" || project.deviceMode === "cuda" || project.deviceMode === "cpu") {
      setDeviceMode(project.deviceMode);
    }
    setOutputPath("");
    setRenderProgress(0);
    setRenderStage("idle");
  }

  async function saveProject(saveAs = false) {
    let target = projectFilePath;

    if (!target || saveAs) {
      const suggestedName = videoPath
        ? fileName(videoPath).replace(/\.[^.]+$/, "") + ".vmagic"
        : "VideoMagic Project.vmagic";
      const selected = await save({
        title: "Save VideoMagic project",
        defaultPath: suggestedName,
        filters: [{ name: "VideoMagic Project", extensions: ["vmagic"] }],
      });
      if (typeof selected !== "string") return;
      target = selected.toLowerCase().endsWith(".vmagic") ? selected : selected + ".vmagic";
    }

    try {
      await invoke("save_project_file", {
        path: target,
        project: projectSnapshot(),
      });
      setProjectFilePath(target);
      setLastSavedAt(Date.now());
      setStatus("Project saved");
      await refreshRecentProjects();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openProject() {
    if (isGenerating) return;

    const selected = await open({
      multiple: false,
      directory: false,
      title: "Open VideoMagic project",
      filters: [{ name: "VideoMagic Project", extensions: ["vmagic"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const result = await invoke<ProjectFileResult>("load_project_file", {
        path: selected,
      });
      applyProject(result.project);
      setProjectFilePath(result.path);
      setLastSavedAt(Date.now());
      setStatus("Project opened");
      await refreshRecentProjects();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openRecentProject(path: string) {
    if (isGenerating) return;
    try {
      const result = await invoke<ProjectFileResult>("load_project_file", { path });
      applyProject(result.project);
      setProjectFilePath(result.path);
      setLastSavedAt(Date.now());
      setShowRecentProjects(false);
      setStatus("Project opened");
      await refreshRecentProjects();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      await refreshRecentProjects();
    }
  }

  async function removeRecentProject(path: string) {
    await invoke<boolean>("remove_recent_project", { path });
    await refreshRecentProjects();
  }

  async function clearRecentProjects() {
    await invoke<boolean>("clear_recent_projects");
    setRecentProjects([]);
  }

  function applyCreatorPreset(preset: CreatorPreset) {
    if (voices.some((item) => item.id === preset.voice)) {
      setVoice(preset.voice);
    }
    setSpeed(preset.speed);
    setOriginalVolume(preset.originalVolume);
    setDucking(preset.ducking);
    setAutoTiming(preset.autoTiming);
    setSubtitles(preset.subtitles);
    setStatus("Preset applied: " + preset.name);
  }

  function saveCreatorPreset() {
    const name = presetName.trim();
    if (!name) return;
    const preset: CreatorPreset = {
      id: "custom-" + Date.now(),
      name,
      voice,
      speed,
      originalVolume,
      ducking,
      autoTiming,
      subtitles,
      custom: true,
    };
    setCustomPresets((current) => [preset, ...current].slice(0, 12));
    setPresetName("");
    setShowPresetForm(false);
    setStatus("Creator preset saved");
  }

  function deleteCreatorPreset(id: string) {
    setCustomPresets((current) => current.filter((item) => item.id !== id));
  }

  function newProject() {
    if (isGenerating) return;
    previewAudio.current?.pause();
    setIsPreviewing(false);
    setProjectFilePath("");
    setVideoPath("");
    setScript("");
    setOutputPath("");
    setRenderProgress(0);
    setRenderStage("idle");
    setStatus("New project");
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openProject();
      }

      if (commandKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        void chooseVideo();
      }

      if (commandKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject(event.shiftKey);
      }

      if (commandKey && event.key === "Enter" && canGenerate) {
        event.preventDefault();
        void generate();
      }

      if (commandKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newProject();
      }

      if (event.key === "Escape" && isGenerating) {
        event.preventDefault();
        void cancelRender();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canGenerate,
    isGenerating,
    videoPath,
    script,
    voice,
    speed,
    originalVolume,
    outputDir,
    ducking,
    autoTiming,
    subtitles,
    projectFilePath,
    deviceMode,
  ]);

  const progressWidth = String(Math.max(0, Math.min(100, renderProgress * 100))) + "%";
  const runtimeProgressWidth = String(Math.max(0, Math.min(100, runtimeProgress * 100))) + "%";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div className="brand-copy">
            <strong>VideoMagic</strong>
            <span>Local AI voiceover studio</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className="topbar-button"
            type="button"
            disabled={isGenerating}
            onClick={newProject}
            title="New project (Ctrl+Shift+N)"
          >
            New
          </button>
          <button
            className="topbar-button"
            type="button"
            disabled={isGenerating}
            onClick={openProject}
            title="Open project (Ctrl+O)"
          >
            Open
          </button>
          <button
            className="topbar-button"
            type="button"
            disabled={isGenerating}
            onClick={() => {
              void refreshRecentProjects();
              setShowRecentProjects(true);
            }}
            title="Recent projects"
          >
            Recent
          </button>
          <button
            className="topbar-button"
            type="button"
            onClick={() => void openSettings()}
            title="Settings and diagnostics"
          >
            Settings
          </button>
          <button
            className="topbar-button emphasis"
            type="button"
            disabled={isGenerating}
            onClick={() => void saveProject(false)}
            title="Save project (Ctrl+S)"
          >
            Save
          </button>
          <div className={"runtime-pill " + (runtime?.ready ? "ready" : "")}>
            <span className="status-dot" />
            {runtime?.ready ? "Local AI ready" : "Runtime setup required"}
          </div>
        </div>
      </header>

      <section className="project-header">
        <div>
          <span className="project-kicker">
            {projectFilePath
              ? fileName(projectFilePath).replace(/\.vmagic$/i, "")
              : videoPath
                ? fileName(videoPath).replace(/\.[^.]+$/, "")
                : "UNTITLED PROJECT"}
            {lastSavedAt ? (projectFilePath ? " · SAVED" : " · AUTOSAVED") : ""}
          </span>
          <h1>Create voiceover video</h1>
          <p>Import a clip, write the narration, choose a voice, then render locally.</p>
        </div>
        <div className="privacy-note">
          <strong>100% local core workflow</strong>
          <span>Your source video stays on this PC.</span>
        </div>
      </section>

      <section className="studio-grid">
        <div className="editor-column">
          <section className="workspace-card media-card">
            <div className="section-heading">
              <div>
                <span className="section-index">01</span>
                <div>
                  <h2>Source video</h2>
                  <p>MP4, MOV, MKV, WEBM or M4V</p>
                </div>
              </div>
              {videoPath && (
                <button className="text-button" type="button" onClick={chooseVideo}>
                  Replace
                </button>
              )}
            </div>

            <button
              className={
                "video-picker " +
                (videoPath ? "selected " : "") +
                (isDragging ? "dragging" : "")
              }
              type="button"
              onClick={chooseVideo}
            >
              <div className="video-picker-icon">{videoPath ? "✓" : isDragging ? "↓" : "+"}</div>
              <div className="video-picker-copy">
                <strong>
                  {isDragging
                    ? "Drop video to import"
                    : videoPath
                      ? fileName(videoPath)
                      : "Choose or drop a source video"}
                </strong>
                <span>
                  {isDragging
                    ? "Release anywhere in the window."
                    : videoPath
                      ? videoPath
                      : "VideoMagic reads and renders the file locally."}
                </span>
              </div>
              <span className="picker-action">{videoPath ? "Selected" : "Browse"}</span>
            </button>
          </section>

          <section className="workspace-card script-card">
            <div className="section-heading">
              <div>
                <span className="section-index">02</span>
                <div>
                  <h2>Narration script</h2>
                  <p>Write the voiceover exactly as you want it spoken.</p>
                </div>
              </div>
              <span className="character-count">{script.length} chars</span>
            </div>

            <textarea
              className="script-editor"
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="比如：不是哥们，这猴子是真的没拿自己当外人。上来先把游客的可乐抢了，结果下一秒更离谱……"
            />

            <div className="script-tools">
              <span>Mandarin punctuation and natural pauses are supported.</span>
              <button
                className="preview-button"
                type="button"
                disabled={!runtime?.ready || isPreviewing}
                onClick={previewSelectedVoice}
              >
                <span className="play-icon">{isPreviewing ? "■" : "▶"}</span>
                {isPreviewing ? "Playing preview" : "Preview selected voice"}
              </button>
            </div>
          </section>

          <section className="task-card">
            <div className="task-summary">
              <div className={"task-icon " + renderStage}>↗</div>
              <div className="task-copy">
                <div className="task-title-row">
                  <strong>{status}</strong>
                  <span>{Math.round(renderProgress * 100)}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: progressWidth }} />
                </div>
                <span className="task-stage">
                  {renderStage === "idle"
                    ? "Ready to render"
                    : renderStage === "tts"
                      ? "AI voice generation"
                      : renderStage === "subtitles"
                        ? "Building synchronized subtitles"
                        : renderStage === "mix"
                          ? "Audio ducking and final render"
                          : renderStage === "probe"
                            ? "Reading source video"
                            : renderStage === "done"
                          ? "Export complete"
                          : renderStage}
                </span>
              </div>
            </div>

            <div className="task-actions">
              {isGenerating ? (
                <button className="secondary-button danger" type="button" onClick={cancelRender}>
                  Cancel
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  disabled={!canGenerate}
                  onClick={generate}
                >
                  Generate video
                  <span>→</span>
                </button>
              )}
            </div>
          </section>

          {outputPath && (
            <section className="output-card">
              <div>
                <span className="output-label">LATEST EXPORT</span>
                <strong>{fileName(outputPath)}</strong>
                <code>{outputPath}</code>
              </div>
              <button className="secondary-button" type="button" onClick={showOutput}>
                Show in folder
              </button>
            </section>
          )}

          {renderHistory.length > 0 && (
            <section className="render-history-card">
              <div className="history-heading">
                <div>
                  <span className="output-label">RECENT EXPORTS</span>
                  <strong>Render history</strong>
                </div>
                <button className="text-button" type="button" onClick={clearRenderHistory}>
                  Clear
                </button>
              </div>

              <div className="render-history-list">
                {renderHistory.slice(0, 6).map((item) => (
                  <article className={"render-history-item " + (!item.exists ? "missing" : "")} key={item.id}>
                    <button
                      className="render-history-main"
                      type="button"
                      disabled={!item.exists}
                      onClick={() => openRenderFile(item)}
                    >
                      <div className="render-history-icon">▶</div>
                      <div className="render-history-copy">
                        <strong>{item.name}</strong>
                        <span>
                          {new Date(item.createdAt * 1000).toLocaleString()} · {item.voice} · {item.speed.toFixed(2)}×
                          {typeof item.durationSeconds === "number"
                            ? " · " + Math.round(item.durationSeconds) + "s"
                            : ""}
                        </span>
                        <code>{item.path}</code>
                      </div>
                    </button>
                    <div className="render-history-actions">
                      <button type="button" onClick={() => reuseRenderSettings(item)}>Use settings</button>
                      <button type="button" disabled={!item.exists} onClick={() => showRenderInFolder(item)}>Folder</button>
                      <button type="button" onClick={() => removeRenderHistory(item.id)}>Remove</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="inspector-column">
          <section className={"runtime-card " + (runtime?.portableReady ? "ready" : "")}>
            <div className="runtime-header">
              <div>
                <span className="runtime-kicker">LOCAL AI RUNTIME</span>
                <strong>
                  {runtime?.portableReady
                    ? "Ready"
                    : runtime?.developmentReady
                      ? "Development runtime"
                      : "Setup required"}
                </strong>
              </div>
              <span className={"runtime-indicator " + (runtime?.ready ? "ready" : "")} />
            </div>

            <p>
              {runtime?.dataDir
                ? runtime.dataDir
                : "Choose a drive or folder for Python, models, cache and FFmpeg."}
            </p>

            {runtime?.ready && (
              <div className={"engine-warm-status " + (engineWarm ? "warm" : "")}>
                <span />
                <strong>{engineWarm ? "AI engine warm" : "AI engine cold"}</strong>
                <small>{engineWarm ? "Model stays loaded for faster previews and renders." : "First voice task will load the local model."}</small>
              </div>
            )}

            {isBootstrapping && (
              <div className="runtime-progress">
                <div className="task-title-row">
                  <span>{runtimeMessage || "Setting up local AI"}</span>
                  <span>{Math.round(runtimeProgress * 100)}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: runtimeProgressWidth }} />
                </div>
              </div>
            )}

            {!runtime?.portableReady && (
              <div className="runtime-actions">
                <button
                  className="secondary-button full-width"
                  type="button"
                  disabled={isBootstrapping}
                  onClick={() => void setupRuntime(Boolean(runtime?.configured && runtime?.dataDir))}
                >
                  {isBootstrapping
                    ? "Repairing local runtime…"
                    : runtime?.configured && runtime?.dataDir
                      ? "Repair runtime"
                      : "Set up local runtime"}
                </button>
                {runtime?.configured && runtime?.dataDir && (
                  <button
                    className="text-button"
                    type="button"
                    disabled={isBootstrapping}
                    onClick={() => void setupRuntime(false)}
                  >
                    Change location
                  </button>
                )}
              </div>
            )}

            {runtime?.portableReady && (
              <button
                className="text-button runtime-repair"
                type="button"
                disabled={isBootstrapping}
                onClick={() => void setupRuntime(true)}
              >
                Verify / repair runtime
              </button>
            )}

            <div className="inference-mode">
              <div>
                <strong>Inference</strong>
                <span>Auto prefers CUDA and falls back to CPU.</span>
              </div>
              <div className="segmented-control">
                {(["auto", "cuda", "cpu"] as InferenceMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={deviceMode === mode ? "selected" : ""}
                    onClick={() => setDeviceMode(mode)}
                  >
                    {mode === "auto" ? "Auto" : mode === "cuda" ? "GPU" : "CPU"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="inspector-section">
            <div className="inspector-heading">
              <div>
                <span className="section-index">03</span>
                <h2>Voice</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Preview selected voice"
                disabled={!runtime?.ready || isPreviewing}
                onClick={previewSelectedVoice}
              >
                {isPreviewing ? "■" : "▶"}
              </button>
            </div>

            <div className="preset-toolbar">
              <select
                defaultValue=""
                onChange={(event) => {
                  const preset = [...builtinPresets, ...customPresets].find(
                    (item) => item.id === event.target.value,
                  );
                  if (preset) applyCreatorPreset(preset);
                  event.currentTarget.value = "";
                }}
              >
                <option value="" disabled>Apply creator preset…</option>
                <optgroup label="Built in">
                  {builtinPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </optgroup>
                {customPresets.length > 0 && (
                  <optgroup label="My presets">
                    {customPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                className="text-button"
                type="button"
                onClick={() => setShowPresetForm((current) => !current)}
              >
                Save current
              </button>
            </div>

            {showPresetForm && (
              <div className="preset-form">
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveCreatorPreset();
                    if (event.key === "Escape") setShowPresetForm(false);
                  }}
                />
                <button type="button" onClick={saveCreatorPreset} disabled={!presetName.trim()}>
                  Save
                </button>
              </div>
            )}

            {customPresets.length > 0 && (
              <div className="preset-chips">
                {customPresets.slice(0, 5).map((preset) => (
                  <div className="preset-chip" key={preset.id}>
                    <button type="button" onClick={() => applyCreatorPreset(preset)}>
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      className="preset-delete"
                      aria-label={"Delete preset " + preset.name}
                      onClick={() => deleteCreatorPreset(preset.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="voice-list">
              {voices.map((item) => (
                <button
                  key={item.id}
                  className={"voice-option " + (voice === item.id ? "selected" : "")}
                  onClick={() => setVoice(item.id)}
                  type="button"
                >
                  <div className="voice-avatar">{item.name.slice(0, 1)}</div>
                  <div className="voice-copy">
                    <strong>{item.name}</strong>
                    <span>{item.description}</span>
                  </div>
                  <em>{item.tag}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <div className="inspector-heading">
              <div>
                <span className="section-index">04</span>
                <h2>Mix</h2>
              </div>
            </div>

            <div className="control-block">
              <div className="control-label">
                <span>Voice speed</span>
                <strong>{speed.toFixed(2)}×</strong>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.3"
                step="0.05"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
            </div>

            <div className="control-block">
              <div className="control-label">
                <span>Source audio level</span>
                <strong>{originalVolume}%</strong>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={originalVolume}
                onChange={(event) => setOriginalVolume(Number(event.target.value))}
              />
            </div>

            <label className="switch-row">
              <div>
                <strong>Smart ducking</strong>
                <span>Lower source audio only while narration is speaking.</span>
              </div>
              <input
                type="checkbox"
                checked={ducking}
                onChange={(event) => setDucking(event.target.checked)}
              />
            </label>

            <label className="switch-row">
              <div>
                <strong>Auto timing</strong>
                <span>Split the script into sentences and spread narration across the clip.</span>
              </div>
              <input
                type="checkbox"
                checked={autoTiming}
                onChange={(event) => setAutoTiming(event.target.checked)}
              />
            </label>

            <label className="switch-row">
              <div>
                <strong>Burn subtitles</strong>
                <span>Create synchronized captions from the same narration timeline.</span>
              </div>
              <input
                type="checkbox"
                checked={subtitles}
                onChange={(event) => setSubtitles(event.target.checked)}
              />
            </label>
          </section>

          <section className="inspector-section">
            <div className="inspector-heading">
              <div>
                <span className="section-index">05</span>
                <h2>Export</h2>
              </div>
            </div>

            <button className="folder-picker" type="button" onClick={chooseOutputDir}>
              <div>
                <span>Output folder</span>
                <strong>{outputDir ? fileName(outputDir) : "Choose folder"}</strong>
              </div>
              <span>…</span>
            </button>
            {outputDir && <code className="folder-path">{outputDir}</code>}

            <div className="export-specs">
              <div><span>Container</span><strong>MP4</strong></div>
              <div>
                <span>Video</span>
                <strong>{subtitles ? "H.264 · caption render" : "Source stream"}</strong>
              </div>
              <div><span>Audio</span><strong>AAC · 192 kbps</strong></div>
              <div><span>Timing</span><strong>{autoTiming ? "Auto spread" : "Compact"}</strong></div>
            </div>
          </section>
        </aside>
      </section>

      {showSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
          <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="runtime-kicker">VIDEOMAGIC DESKTOP</span>
                <h2>Settings & diagnostics</h2>
                <p>Runtime health, hardware selection and local installation details.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close settings"
                onClick={() => setShowSettings(false)}
              >
                ×
              </button>
            </div>

            <div className="settings-content">
              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <strong>Application</strong>
                    <span>Installed desktop build</span>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    disabled={isLoadingDiagnostics}
                    onClick={() => void refreshDiagnostics()}
                  >
                    {isLoadingDiagnostics ? "Checking…" : "Refresh"}
                  </button>
                </div>

                <div className="diagnostic-grid">
                  <div><span>Version</span><strong>{diagnostics?.appVersion ?? "—"}</strong></div>
                  <div><span>Platform</span><strong>{diagnostics ? diagnostics.platform + " · " + diagnostics.arch : "—"}</strong></div>
                  <div><span>Engine</span><strong>{diagnostics?.engine?.engineVersion ?? "—"}</strong></div>
                  <div><span>Python</span><strong>{diagnostics?.engine?.python ?? "—"}</strong></div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <strong>AI runtime</strong>
                    <span>{runtime?.ready ? "Healthy and ready for local rendering." : "Runtime requires attention."}</span>
                  </div>
                  <span className={"health-badge " + (runtime?.ready ? "healthy" : "warning")}>
                    {runtime?.ready ? "Healthy" : "Attention"}
                  </span>
                </div>

                <div className="settings-path">
                  <span>Data location</span>
                  <code>{runtime?.dataDir ?? "Not configured"}</code>
                </div>

                <div className="settings-actions">
                  {runtime?.dataDir && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void openPath(runtime.dataDir as string)}
                    >
                      Open data folder
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isBootstrapping || !runtime?.dataDir}
                    onClick={() => void setupRuntime(true)}
                  >
                    {isBootstrapping ? "Repairing…" : "Verify / repair"}
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <strong>Inference hardware</strong>
                    <span>Auto uses CUDA when available and falls back to CPU on failure.</span>
                  </div>
                </div>
                <div className="segmented-control settings-segmented">
                  {(["auto", "cuda", "cpu"] as InferenceMode[]).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={deviceMode === mode ? "selected" : ""}
                      onClick={() => setDeviceMode(mode)}
                    >
                      {mode === "auto" ? "Auto" : mode === "cuda" ? "NVIDIA GPU" : "CPU"}
                    </button>
                  ))}
                </div>

                <div className="diagnostic-grid hardware-grid">
                  <div>
                    <span>CUDA</span>
                    <strong>{diagnostics?.engine?.gpu?.cudaAvailable ? "Available" : "Not available"}</strong>
                  </div>
                  <div>
                    <span>GPU</span>
                    <strong>{diagnostics?.engine?.gpu?.device ?? "—"}</strong>
                  </div>
                  <div>
                    <span>PyTorch</span>
                    <strong>{diagnostics?.engine?.gpu?.torchVersion ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Kokoro</span>
                    <strong>{diagnostics?.engine?.kokoroInstalled ? "Installed" : "Not detected"}</strong>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <strong>Media engine</strong>
                    <span>App-local FFmpeg is used for probing, mixing, subtitles and export.</span>
                  </div>
                </div>
                <div className="settings-path compact">
                  <span>FFmpeg</span>
                  <code>{diagnostics?.engine?.ffmpeg ?? "—"}</code>
                </div>
                <div className="settings-path compact">
                  <span>FFprobe</span>
                  <code>{diagnostics?.engine?.ffprobe ?? "—"}</code>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <strong>Keyboard shortcuts</strong>
                    <span>Desktop-first project workflow</span>
                  </div>
                </div>
                <div className="shortcut-grid">
                  <div><span>New project</span><kbd>Ctrl + Shift + N</kbd></div>
                  <div><span>Open project</span><kbd>Ctrl + O</kbd></div>
                  <div><span>Save project</span><kbd>Ctrl + S</kbd></div>
                  <div><span>Import video</span><kbd>Ctrl + I</kbd></div>
                  <div><span>Render</span><kbd>Ctrl + Enter</kbd></div>
                  <div><span>Cancel render</span><kbd>Esc</kbd></div>
                </div>
              </section>

              {diagnostics?.engine?.error && (
                <section className="settings-error">
                  <strong>Diagnostics error</strong>
                  <code>{diagnostics.engine.error}</code>
                </section>
              )}
            </div>

            <div className="modal-footer">
              <button className="text-button" type="button" onClick={() => void copyDiagnostics()}>
                {diagnosticsCopied ? "Copied" : "Copy diagnostics"}
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      {showRecentProjects && (
        <div className="modal-backdrop" onMouseDown={() => setShowRecentProjects(false)}>
          <section className="recent-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="runtime-kicker">PROJECTS</span>
                <h2>Recent projects</h2>
                <p>Open a recent .vmagic project without browsing for the file again.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close recent projects"
                onClick={() => setShowRecentProjects(false)}
              >
                ×
              </button>
            </div>

            <div className="recent-list">
              {recentProjects.length === 0 ? (
                <div className="empty-recent">
                  <strong>No recent projects yet</strong>
                  <span>Projects you save or open will appear here.</span>
                </div>
              ) : (
                recentProjects.map((project) => (
                  <div className={"recent-row " + (!project.exists ? "missing" : "")} key={project.path}>
                    <button
                      className="recent-open"
                      type="button"
                      disabled={!project.exists}
                      onClick={() => void openRecentProject(project.path)}
                    >
                      <div className="recent-icon">VM</div>
                      <div>
                        <strong>{project.name}</strong>
                        <span>{project.path}</span>
                      </div>
                    </button>
                    <button
                      className="recent-remove"
                      type="button"
                      aria-label={"Remove " + project.name + " from recent projects"}
                      onClick={() => void removeRecentProject(project.path)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="modal-footer">
              <button className="text-button" type="button" onClick={() => void clearRecentProjects()}>
                Clear list
              </button>
              <button className="secondary-button" type="button" onClick={() => setShowRecentProjects(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
