import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import "./app.css";

type VoicePreset = {
  id: string;
  name: string;
  description: string;
  tag: string;
  language: "zh" | "en-US" | "en-GB";
  languageLabel: string;
};

type InferenceMode = "auto" | "cuda" | "cpu";

type TimelineSegment = {
  id: string;
  text: string;
  start: number;
  end: number;
  windowEnd?: number;
  speed?: number;
};

type VideoInfo = {
  path: string;
  durationSeconds: number;
  hasAudio: boolean;
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
};

type TimelinePlan = {
  timeline: TimelineSegment[];
  durationSeconds: number;
  draft: boolean;
};

type WaveformResult = {
  peaks: number[];
  points: number;
  durationSeconds: number;
  hasAudio: boolean;
};

type AiEditClip = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  outputStart: number;
  outputEnd: number;
  narration: string;
  reason: string;
};

type AiEditPlan = {
  title: string;
  summary: string;
  narrationLanguage: "zh" | "en";
  sourceDurationSeconds: number;
  outputDurationSeconds: number;
  clips: AiEditClip[];
  model: string;
};

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
  timeline?: TimelineSegment[] | null;
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
  editPlan?: AiEditPlan;
  video?: {
    path?: string;
    videoDurationSeconds?: number;
    ducking?: boolean;
  };
  narration?: {
    timeline?: TimelineSegment[];
    customTimeline?: boolean;
    autoTiming?: boolean;
    device?: string;
  } | null;
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
    videoIntelligence?: {
      provider?: string;
      model?: string;
      dependenciesInstalled?: boolean;
      modelCached?: boolean;
      cachePath?: string | null;
    };
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
  timeline?: TimelineSegment[];
  videoDuration?: number;
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
  { id: "zm_009", name: "Punchy Male", description: "Sharper pacing for commentary and short-form clips.", tag: "Fast", language: "zh", languageLabel: "Mandarin" },
  { id: "zm_010", name: "Story Male", description: "Natural Mandarin narration with a balanced tone.", tag: "Story", language: "zh", languageLabel: "Mandarin" },
  { id: "zm_011", name: "Deep Male", description: "Steadier voice for explainers and documentary content.", tag: "Deep", language: "zh", languageLabel: "Mandarin" },
  { id: "zf_001", name: "Bright Female", description: "Clear, lighter delivery for lifestyle and social clips.", tag: "Bright", language: "zh", languageLabel: "Mandarin" },
  { id: "af_heart", name: "Heart", description: "Warm American English narration.", tag: "US · Warm", language: "en-US", languageLabel: "English (US)" },
  { id: "af_bella", name: "Bella", description: "Expressive American English creator voice.", tag: "US · Expressive", language: "en-US", languageLabel: "English (US)" },
  { id: "am_michael", name: "Michael", description: "Clean American English male narration.", tag: "US · Clear", language: "en-US", languageLabel: "English (US)" },
  { id: "am_puck", name: "Puck", description: "Energetic American English for short-form edits.", tag: "US · Energy", language: "en-US", languageLabel: "English (US)" },
  { id: "bf_emma", name: "Emma", description: "Warm British English female narration.", tag: "UK · Warm", language: "en-GB", languageLabel: "English (UK)" },
  { id: "bm_george", name: "George", description: "Classic British English male narration.", tag: "UK · Classic", language: "en-GB", languageLabel: "English (UK)" },
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

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes + ":" + rest.toFixed(1).padStart(4, "0");
}

function App() {
  const [videoPath, setVideoPath] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [timeline, setTimeline] = useState<TimelineSegment[]>([]);
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [script, setScript] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTargetDuration, setAiTargetDuration] = useState("auto");
  const [lastAiPlan, setLastAiPlan] = useState<AiEditPlan | null>(null);
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const projectHydrated = useRef(false);

  const canGenerate = Boolean(
    runtime?.ready &&
      videoPath &&
      script.trim().length > 0 &&
      !isGenerating &&
      !isBootstrapping,
  );

  const canAiEdit = Boolean(
    runtime?.ready &&
      videoPath &&
      aiInstruction.trim().length > 0 &&
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
        if (Array.isArray(saved.timeline)) {
          setTimeline(saved.timeline);
          setSelectedSegmentId(saved.timeline[0]?.id ?? "");
          setTimelineDirty(false);
        }
        if (typeof saved.videoDuration === "number" && saved.videoDuration > 0 && typeof saved.videoPath === "string") {
          setVideoInfo({
            path: saved.videoPath,
            durationSeconds: saved.videoDuration,
            hasAudio: true,
          });
        }
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
        timeline,
        videoDuration: videoInfo?.durationSeconds,
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
    timeline,
    videoInfo?.durationSeconds,
  ]);

  useEffect(() => {
    if (!videoPath) {
      setPreviewReady(false);
      setVideoInfo(null);
      setWaveform([]);
      setWaveformLoading(false);
      setCurrentTime(0);
      return;
    }

    let disposed = false;
    setPreviewReady(false);

    void (async () => {
      try {
        await invoke<boolean>("allow_preview_file", { path: videoPath });
        if (disposed) return;
        setPreviewReady(true);

        if (runtime?.ready) {
          const info = await invoke<VideoInfo>("probe_video_info", {
            videoPath,
            deviceMode,
          });
          if (!disposed) {
            setVideoInfo(info);
            setWaveformLoading(info.hasAudio);
          }

          if (info.hasAudio) {
            try {
              const wave = await invoke<WaveformResult>("video_waveform", {
                videoPath,
                points: 260,
                deviceMode,
              });
              if (!disposed) {
                setWaveform(wave.peaks);
              }
            } finally {
              if (!disposed) setWaveformLoading(false);
            }
          } else if (!disposed) {
            setWaveform([]);
            setWaveformLoading(false);
          }
        }
      } catch (error) {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [videoPath, runtime?.ready, deviceMode]);

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
              selectVideoPath(path);
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

  function selectVideoPath(path: string) {
    setVideoPath(path);
    setWaveform([]);
    setWaveformLoading(false);
    setOutputPath("");
    setLastAiPlan(null);
    setRenderProgress(0);
    setRenderStage("idle");
    setCurrentTime(0);
    setTimeline([]);
    setTimelineDirty(false);
    setSelectedSegmentId("");
    setStatus("Video ready");
  }

  async function buildTimeline() {
    if (!runtime?.ready || !videoInfo?.durationSeconds || !script.trim()) return;

    setStatus("Planning narration timeline…");
    try {
      const result = await invoke<TimelinePlan>("plan_narration_timeline", {
        text: script.trim(),
        targetDuration: videoInfo.durationSeconds,
        voice,
        deviceMode,
      });
      setTimeline(result.timeline);
      setSelectedSegmentId(result.timeline[0]?.id ?? "");
      setTimelineDirty(false);
      setStatus("Narration timeline ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function seekVideo(time: number) {
    const duration = videoInfo?.durationSeconds ?? 0;
    const next = Math.max(0, Math.min(duration || time, time));
    setCurrentTime(next);
    if (videoRef.current) {
      videoRef.current.currentTime = next;
    }
  }

  function updateTimelineSegmentText(id: string, text: string) {
    setTimeline((current) => {
      const updated = current.map((segment) =>
        segment.id === id ? { ...segment, text } : segment,
      );
      setScript(updated.map((segment) => segment.text.trim()).filter(Boolean).join(" "));
      return updated;
    });
    setTimelineDirty(false);
  }

  function updateTimelineBounds(id: string, nextStart: number, nextEnd: number) {
    if (
      !videoInfo?.durationSeconds ||
      !Number.isFinite(nextStart) ||
      !Number.isFinite(nextEnd)
    ) return;

    setTimeline((current) => {
      const index = current.findIndex((segment) => segment.id === id);
      if (index < 0) return current;

      const previousEnd = index > 0 ? current[index - 1].end + 0.03 : 0;
      const nextStartLimit =
        index < current.length - 1
          ? current[index + 1].start - 0.03
          : videoInfo.durationSeconds;

      const minimumDuration = 0.08;
      const start = Math.max(previousEnd, Math.min(nextStart, nextStartLimit - minimumDuration));
      const end = Math.max(
        start + minimumDuration,
        Math.min(nextEnd, nextStartLimit, videoInfo.durationSeconds),
      );

      return current.map((segment, itemIndex) =>
        itemIndex === index ? { ...segment, start, end } : segment,
      );
    });
    setTimelineDirty(false);
  }

  function beginTimelineDrag(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if (!videoInfo?.durationSeconds || !timelineTrackRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const index = timeline.findIndex((segment) => segment.id === id);
    const segment = timeline[index];
    if (!segment) return;

    setSelectedSegmentId(id);
    seekVideo(segment.start);

    const rect = timelineTrackRef.current.getBoundingClientRect();
    const initialX = event.clientX;
    const originalStart = segment.start;
    const duration = segment.end - segment.start;
    const previousEnd = index > 0 ? timeline[index - 1].end + 0.03 : 0;
    const nextStartLimit =
      index < timeline.length - 1
        ? timeline[index + 1].start - 0.03
        : videoInfo.durationSeconds;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSeconds =
        ((moveEvent.clientX - initialX) / Math.max(rect.width - 92, 1)) *
        videoInfo.durationSeconds;
      const start = Math.max(
        previousEnd,
        Math.min(originalStart + deltaSeconds, nextStartLimit - duration),
      );
      updateTimelineBounds(id, start, start + duration);
      seekVideo(start);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginTimelineResize(
    event: React.PointerEvent<HTMLSpanElement>,
    id: string,
    edge: "start" | "end",
  ) {
    if (!videoInfo?.durationSeconds || !timelineTrackRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const index = timeline.findIndex((segment) => segment.id === id);
    const segment = timeline[index];
    if (!segment) return;

    setSelectedSegmentId(id);
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const initialX = event.clientX;
    const originalStart = segment.start;
    const originalEnd = segment.end;
    const previousEnd = index > 0 ? timeline[index - 1].end + 0.03 : 0;
    const nextStart =
      index < timeline.length - 1
        ? timeline[index + 1].start - 0.03
        : videoInfo.durationSeconds;
    const minimumDuration = 0.08;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSeconds =
        ((moveEvent.clientX - initialX) / Math.max(rect.width - 92, 1)) *
        videoInfo.durationSeconds;

      if (edge === "start") {
        const start = Math.max(
          previousEnd,
          Math.min(originalStart + deltaSeconds, originalEnd - minimumDuration),
        );
        updateTimelineBounds(id, start, originalEnd);
        seekVideo(start);
      } else {
        const end = Math.min(
          nextStart,
          Math.max(originalEnd + deltaSeconds, originalStart + minimumDuration),
        );
        updateTimelineBounds(id, originalStart, end);
        seekVideo(end);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function previewTimelineSegment(segment: TimelineSegment) {
    if (!runtime?.ready || isPreviewing || !segment.text.trim()) return;

    previewAudio.current?.pause();
    setIsPreviewing(true);
    setSelectedSegmentId(segment.id);
    seekVideo(segment.start);
    setStatus("Generating segment preview…");

    try {
      const result = await invoke<PreviewResult>("preview_voice", {
        voice,
        speed,
        text: segment.text.trim(),
        deviceMode,
      });
      const audio = new Audio(result.audioDataUrl);
      previewAudio.current = audio;
      audio.onended = () => setIsPreviewing(false);
      audio.onerror = () => setIsPreviewing(false);
      await audio.play();
      setEngineWarm(true);
      setStatus("Segment preview playing");
    } catch (error) {
      setIsPreviewing(false);
      setStatus(error instanceof Error ? error.message : String(error));
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
      selectVideoPath(selected);
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

  async function runAiEdit() {
    if (!canAiEdit) return;

    const selectedVoice = voices.find((item) => item.id === voice);
    const narrationLanguage =
      selectedVoice?.language.startsWith("en") ? "en" : "zh";
    const targetDuration =
      aiTargetDuration === "auto" ? null : Number(aiTargetDuration);

    setIsGenerating(true);
    setOutputPath("");
    setLastAiPlan(null);
    setRenderProgress(0.02);
    setRenderStage("analyze");
    setStatus("Video AI is understanding the source…");

    try {
      const result = await invoke<RenderResult>("ai_edit_video", {
        videoPath,
        instruction: aiInstruction.trim(),
        voice,
        speed,
        originalVolume: originalVolume / 100,
        outputDir: outputDir || null,
        ducking,
        subtitles,
        deviceMode,
        targetDuration,
        narrationLanguage,
      });

      const rendered = result.video?.path ?? "";
      setOutputPath(rendered);
      setLastAiPlan(result.editPlan ?? null);
      setRenderProgress(1);
      setRenderStage("done");
      setEngineWarm(true);
      setStatus(rendered ? "AI edit ready" : "AI edit completed");
      await refreshRenderHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("cancel")) {
        setRenderStage("cancelled");
        setRenderProgress(0);
        setStatus("AI edit cancelled");
      } else {
        setRenderStage("error");
        setStatus(message);
      }
    } finally {
      setIsGenerating(false);
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
        timeline:
          timeline.length > 0 && !timelineDirty
            ? timeline.map((segment) => ({
                id: segment.id,
                text: segment.text,
                start: segment.start,
                end: segment.end,
              }))
            : null,
      });

      const rendered = result.video?.path ?? "";
      setOutputPath(rendered);
      setRenderProgress(1);
      setRenderStage("done");
      setEngineWarm(true);
      if (result.narration?.timeline?.length) {
        const renderedTimeline = result.narration.timeline.map((segment, index) => ({
          ...segment,
          id: segment.id || "segment-" + String(index + 1),
          end: segment.windowEnd ?? segment.end,
        }));
        setTimeline(renderedTimeline);
        setSelectedSegmentId(renderedTimeline[0]?.id ?? "");
        setTimelineDirty(false);
      }
      if (typeof result.video?.videoDurationSeconds === "number") {
        setVideoInfo((current) => ({
          path: videoPath,
          durationSeconds: result.video?.videoDurationSeconds ?? current?.durationSeconds ?? 0,
          hasAudio: current?.hasAudio ?? true,
          streams: current?.streams,
        }));
      }
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
      timeline,
      videoDuration: videoInfo?.durationSeconds,
    };
  }

  function applyProject(project: Partial<SavedProject>) {
    const restoredVideoPath = typeof project.videoPath === "string" ? project.videoPath : "";
    setVideoPath(restoredVideoPath);
    setScript(typeof project.script === "string" ? project.script : "");
    const restoredTimeline = Array.isArray(project.timeline) ? project.timeline : [];
    setTimeline(restoredTimeline);
    setSelectedSegmentId(restoredTimeline[0]?.id ?? "");
    setTimelineDirty(false);
    setVideoInfo(
      typeof project.videoDuration === "number" && project.videoDuration > 0
        ? {
            path: restoredVideoPath,
            durationSeconds: project.videoDuration,
            hasAudio: true,
          }
        : null,
    );
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
    setVideoInfo(null);
    setWaveform([]);
    setWaveformLoading(false);
    setPreviewReady(false);
    setTimeline([]);
    setTimelineDirty(false);
    setSelectedSegmentId("");
    setCurrentTime(0);
    setScript("");
    setAiInstruction("");
    setAiTargetDuration("auto");
    setLastAiPlan(null);
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
  const videoDuration = videoInfo?.durationSeconds ?? 0;
  const videoPreviewSrc = previewReady && videoPath ? convertFileSrc(videoPath) : "";
  const playheadRatio =
    videoDuration > 0
      ? Math.max(0, Math.min(1, currentTime / videoDuration))
      : 0;
  const playheadPosition =
    "calc(92px + (100% - 92px) * " + String(playheadRatio) + ")";

  const waveformPolygon =
    waveform.length > 1
      ? [
          ...waveform.map(
            (value, index) =>
              String(index) + "," + String(50 - Math.max(0, Math.min(1, value)) * 43),
          ),
          ...waveform
            .map(
              (value, index) =>
                String(index) + "," + String(50 + Math.max(0, Math.min(1, value)) * 43),
            )
            .reverse(),
        ].join(" ")
      : "";

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
          <h1>Create or AI-edit a video</h1>
          <p>Drop in a clip. Write narration yourself, or describe the finished edit you want.</p>
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

            {videoPath && (
              <div className="video-preview-shell">
                {videoPreviewSrc ? (
                  <video
                    key={videoPath}
                    ref={videoRef}
                    className="video-preview"
                    src={videoPreviewSrc}
                    controls
                    preload="metadata"
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => {
                      const duration = event.currentTarget.duration;
                      if (Number.isFinite(duration) && duration > 0) {
                        setVideoInfo((current) => ({
                          path: videoPath,
                          durationSeconds: current?.durationSeconds || duration,
                          hasAudio: current?.hasAudio ?? true,
                          streams: current?.streams,
                        }));
                      }
                    }}
                  />
                ) : (
                  <div className="video-preview-loading">Preparing secure local preview…</div>
                )}
                <div className="video-preview-meta">
                  <span>{videoDuration > 0 ? formatTime(videoDuration) : "Reading duration…"}</span>
                  <span>{videoInfo?.hasAudio === false ? "No source audio" : "Source audio detected"}</span>
                  <span>Local file · not uploaded</span>
                </div>
              </div>
            )}
          </section>

          <section className="workspace-card ai-director-card">
            <div className="section-heading">
              <div>
                <span className="section-index">AI</span>
                <div>
                  <h2>AI Director</h2>
                  <p>Describe the edit you want. Local Video AI chooses the moments and cuts them.</p>
                </div>
              </div>
              <span className="local-ai-badge">MiniCPM-V 4.6 · Local</span>
            </div>

            <textarea
              className="ai-director-input"
              value={aiInstruction}
              onChange={(event) => setAiInstruction(event.target.value)}
              placeholder="例：剪成 30 秒搞笑短视频，开头直接进高潮，保留最离谱的反应，英文旁白，节奏快一点。"
            />

            <div className="ai-director-controls">
              <label>
                <span>Target length</span>
                <select
                  value={aiTargetDuration}
                  onChange={(event) => setAiTargetDuration(event.target.value)}
                >
                  <option value="auto">Auto</option>
                  <option value="15">15 sec</option>
                  <option value="30">30 sec</option>
                  <option value="60">60 sec</option>
                </select>
              </label>

              <div className="ai-director-language">
                <span>Narration</span>
                <strong>
                  {voices.find((item) => item.id === voice)?.languageLabel ?? "Mandarin"}
                </strong>
                <small>Change the selected voice to switch language.</small>
              </div>

              <button
                className="ai-edit-button"
                type="button"
                disabled={!canAiEdit}
                onClick={() => void runAiEdit()}
              >
                {isGenerating && renderStage === "analyze"
                  ? "Analyzing video…"
                  : "Analyze & Edit"}
              </button>
            </div>

            <div className="ai-director-note">
              <span>Local-only</span>
              <p>
                The first AI edit downloads the open-source Video AI model once to your
                selected VideoMagic data drive. Source video is analyzed locally.
              </p>
            </div>

            {lastAiPlan && (
              <div className="ai-plan-result">
                <div className="ai-plan-summary">
                  <div>
                    <span>AI EDIT PLAN</span>
                    <strong>{lastAiPlan.title}</strong>
                    <p>{lastAiPlan.summary || "Edit plan generated from the source video."}</p>
                  </div>
                  <div className="ai-plan-metrics">
                    <strong>{lastAiPlan.clips.length} clips</strong>
                    <span>{formatTime(lastAiPlan.outputDurationSeconds)}</span>
                  </div>
                </div>

                <div className="ai-plan-clips">
                  {lastAiPlan.clips.map((clip, index) => (
                    <div className="ai-plan-clip" key={clip.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>
                          {formatTime(clip.sourceStart)} → {formatTime(clip.sourceEnd)}
                          {clip.speed !== 1 ? " · " + clip.speed.toFixed(2) + "×" : ""}
                        </strong>
                        <p>{clip.narration || clip.reason || "Selected visual moment"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              onChange={(event) => {
                setScript(event.target.value);
                if (timeline.length > 0) setTimelineDirty(true);
              }}
              placeholder="比如：不是哥们，这猴子是真的没拿自己当外人。上来先把游客的可乐抢了，结果下一秒更离谱……"
            />

            <div className="script-tools">
              <span>
                {voices.find((item) => item.id === voice)?.languageLabel ?? "Narration"} punctuation and natural pauses are supported.
              </span>
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

          <section className="workspace-card timeline-card">
            <div className="section-heading timeline-heading">
              <div>
                <span className="section-index">03</span>
                <div>
                  <h2>Narration timeline</h2>
                  <p>Drag sentence blocks to control exactly when narration starts.</p>
                </div>
              </div>
              <div className="timeline-heading-actions">
                {timelineDirty && <span className="timeline-stale">Out of sync</span>}
                {timeline.length > 0 && !timelineDirty && (
                  <span className="timeline-manual">Manual timing</span>
                )}
                {timeline.length > 0 && (
                  <button
                    className="text-button"
                    type="button"
                    disabled={isGenerating}
                    onClick={() => {
                      setTimeline([]);
                      setTimelineDirty(false);
                      setSelectedSegmentId("");
                      setStatus("Auto timing enabled");
                    }}
                  >
                    Use auto timing
                  </button>
                )}
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={
                    !runtime?.ready ||
                    !videoInfo?.durationSeconds ||
                    !script.trim() ||
                    isGenerating
                  }
                  onClick={() => void buildTimeline()}
                >
                  {timeline.length > 0 ? "Rebuild timeline" : "Build timeline"}
                </button>
              </div>
            </div>

            {!videoPath || !script.trim() ? (
              <div className="timeline-empty">
                <strong>Add a video and narration script first.</strong>
                <span>VideoMagic will split the script into editable sentence blocks.</span>
              </div>
            ) : timeline.length === 0 ? (
              <div className="timeline-empty">
                <strong>No manual timeline yet.</strong>
                <span>
                  You can keep using Auto Timing, or build a timeline for frame-aware control.
                </span>
              </div>
            ) : (
              <>
                <div className="timeline-ruler">
                  {[0, 0.25, 0.5, 0.75, 1].map((point) => (
                    <span key={point} style={{ left: String(point * 100) + "%" }}>
                      {formatTime(videoDuration * point)}
                    </span>
                  ))}
                </div>

                <div
                  className="timeline-track"
                  ref={timelineTrackRef}
                  onClick={(event) => {
                    if (!videoDuration) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(
                      0,
                      Math.min(
                        1,
                        (event.clientX - (rect.left + 92)) /
                          Math.max(rect.width - 92, 1),
                      ),
                    );
                    seekVideo(ratio * videoDuration);
                  }}
                >
                  <div className="timeline-track-label">NARRATION</div>
                  <div className={"timeline-waveform " + (waveformLoading ? "loading" : "")}>
                    {waveformPolygon ? (
                      <svg
                        viewBox={"0 0 " + String(Math.max(waveform.length - 1, 1)) + " 100"}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <polygon points={waveformPolygon} />
                      </svg>
                    ) : (
                      <span>{waveformLoading ? "Reading source audio…" : "No waveform"}</span>
                    )}
                  </div>
                  <div className="timeline-playhead" style={{ left: playheadPosition }}>
                    <span>{formatTime(currentTime)}</span>
                  </div>
                  {timeline.map((segment, index) => {
                    const left = videoDuration > 0 ? (segment.start / videoDuration) * 100 : 0;
                    const width =
                      videoDuration > 0
                        ? ((segment.end - segment.start) / videoDuration) * 100
                        : 0;
                    return (
                      <div
                        key={segment.id}
                        role="button"
                        tabIndex={0}
                        className={
                          "timeline-block " +
                          (selectedSegmentId === segment.id ? "selected" : "")
                        }
                        style={{
                          left:
                            "calc(92px + (100% - 92px) * " +
                            String(left / 100) +
                            ")",
                          width:
                            "max(18px, calc((100% - 92px) * " +
                            String(Math.max(width, 1.6) / 100) +
                            "))",
                        }}
                        title={
                          formatTime(segment.start) +
                          " – " +
                          formatTime(segment.end) +
                          "\n" +
                          segment.text
                        }
                        onPointerDown={(event) => beginTimelineDrag(event, segment.id)}
                        onDoubleClick={() => {
                          setSelectedSegmentId(segment.id);
                          seekVideo(segment.start);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedSegmentId(segment.id);
                            seekVideo(segment.start);
                          }
                        }}
                      >
                        <span
                          className="timeline-resize-handle start"
                          title="Resize narration start"
                          onPointerDown={(event) =>
                            beginTimelineResize(event, segment.id, "start")
                          }
                        />
                        <span className="timeline-block-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <strong>{segment.text}</strong>
                        <span
                          className="timeline-resize-handle end"
                          title="Resize narration end"
                          onPointerDown={(event) =>
                            beginTimelineResize(event, segment.id, "end")
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="timeline-help">
                  <span>Drag blocks · pull edge handles to resize · click track to seek</span>
                  <span>{timeline.length} narration segments · {formatTime(videoDuration)}</span>
                </div>

                <div className="timeline-segment-list">
                  {timeline.map((segment, index) => (
                    <article
                      key={segment.id}
                      className={
                        "timeline-segment-editor " +
                        (selectedSegmentId === segment.id ? "selected" : "")
                      }
                      onClick={() => {
                        setSelectedSegmentId(segment.id);
                        seekVideo(segment.start);
                      }}
                    >
                      <div className="segment-number">{String(index + 1).padStart(2, "0")}</div>
                      <div className="segment-content">
                        <input
                          className="segment-text-input"
                          value={segment.text}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateTimelineSegmentText(segment.id, event.target.value)
                          }
                        />
                        <div className="segment-timing">
                          <label>
                            Start
                            <input
                              type="number"
                              min="0"
                              max={videoDuration}
                              step="0.05"
                              value={segment.start.toFixed(2)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                updateTimelineBounds(
                                  segment.id,
                                  Number(event.target.value),
                                  segment.end,
                                )
                              }
                            />
                          </label>
                          <label>
                            End
                            <input
                              type="number"
                              min="0"
                              max={videoDuration}
                              step="0.05"
                              value={segment.end.toFixed(2)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                updateTimelineBounds(
                                  segment.id,
                                  segment.start,
                                  Number(event.target.value),
                                )
                              }
                            />
                          </label>
                          <span className="segment-duration">
                            {(segment.end - segment.start).toFixed(2)}s window
                          </span>
                        </div>
                      </div>
                      <button
                        className="segment-preview-button"
                        type="button"
                        disabled={isPreviewing || !runtime?.ready}
                        onClick={(event) => {
                          event.stopPropagation();
                          void previewTimelineSegment(segment);
                        }}
                      >
                        ▶ Preview
                      </button>
                    </article>
                  ))}
                </div>

                {timelineDirty && (
                  <div className="timeline-warning">
                    The main script changed after this timeline was built. Rebuild the timeline
                    before rendering, or edit sentence text directly inside the timeline.
                  </div>
                )}
              </>
            )}
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
                    <span>{item.languageLabel} · {item.description}</span>
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
                <span>
                  {timeline.length > 0 && !timelineDirty
                    ? "Manual timeline is active and overrides automatic placement."
                    : "Split the script into sentences and spread narration across the clip."}
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoTiming}
                disabled={timeline.length > 0 && !timelineDirty}
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
              <div>
                <span>Timing</span>
                <strong>
                  {timeline.length > 0 && !timelineDirty
                    ? "Manual timeline"
                    : autoTiming
                      ? "Auto spread"
                      : "Compact"}
                </strong>
              </div>
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
                  <div>
                    <span>Video AI</span>
                    <strong>
                      {diagnostics?.engine?.videoIntelligence?.dependenciesInstalled
                        ? diagnostics.engine.videoIntelligence.modelCached
                          ? "Ready"
                          : "Downloads on first use"
                        : "Dependencies missing"}
                    </strong>
                  </div>
                  <div>
                    <span>Video model</span>
                    <strong>{diagnostics?.engine?.videoIntelligence?.model ?? "—"}</strong>
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
