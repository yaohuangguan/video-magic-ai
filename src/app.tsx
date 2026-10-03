import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./app.css";

type VoicePreset = {
  id: string;
  name: string;
  description: string;
  tag: string;
};

type RenderResult = {
  narrationPath?: string;
  video?: { path?: string };
};

type RuntimeStatus = {
  ready: boolean;
  portableReady: boolean;
  developmentReady: boolean;
  configured: boolean;
  dataDir?: string | null;
  message?: string;
};

const voices: VoicePreset[] = [
  { id: "zm_009", name: "吐槽男声", description: "更有劲，适合节奏快的中文解说", tag: "Fast" },
  { id: "zm_010", name: "故事男声", description: "自然男声，第一版默认中文旁白", tag: "Story" },
  { id: "zm_011", name: "沉稳男声", description: "偏稳重，适合信息和纪录片内容", tag: "Deep" },
  { id: "zf_001", name: "轻快女声", description: "清晰明亮，适合生活和短视频", tag: "Bright" },
];

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function dataDirectory(parent: string) {
  return `${parent.replace(/[\\/]+$/, "")}\\VideoMagicData`;
}

function App() {
  const [videoPath, setVideoPath] = useState("");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(voices[1].id);
  const [speed, setSpeed] = useState(1.05);
  const [originalVolume, setOriginalVolume] = useState(24);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [outputPath, setOutputPath] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  const selectedVoice = useMemo(
    () => voices.find((item) => item.id === voice) ?? voices[1],
    [voice],
  );

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

  useEffect(() => {
    void refreshRuntime();
  }, []);

  async function setupRuntime() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Choose a drive or folder for VideoMagic AI data",
    });

    if (typeof selected !== "string") return;

    const target = dataDirectory(selected);
    setIsBootstrapping(true);
    setStatus("Setting up local AI runtime. The first setup downloads several GB…");

    try {
      const result = await invoke<RuntimeStatus>("bootstrap_runtime", {
        dataDir: target,
      });
      setRuntime(result);
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
      setStatus("Video ready");
    }
  }

  async function generate() {
    if (!canGenerate) return;

    setIsGenerating(true);
    setOutputPath("");
    setStatus("Generating local narration and mixing video…");

    try {
      const result = await invoke<RenderResult>("render_video", {
        videoPath,
        text: script.trim(),
        voice,
        speed,
        originalVolume: originalVolume / 100,
      });

      const rendered = result.video?.path ?? "";
      setOutputPath(rendered);
      setStatus(rendered ? "Video ready" : "Render completed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>VideoMagic</strong>
            <span>Local AI commentary studio</span>
          </div>
        </div>
        <div className={`local-badge ${runtime?.ready ? "ready" : ""}`}>
          <span />
          {runtime?.ready ? "AI runtime ready" : "Local first"}
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">WINDOWS · V0.1</p>
        <h1>Video in. Script in. Voiceover video out.</h1>
        <p className="hero-copy">
          VideoMagic generates Mandarin narration locally, lowers the source audio,
          mixes the voiceover, and exports a finished MP4 without uploading your video.
        </p>
      </section>

      <section className="workspace">
        <div className="panel source-panel">
          <div className="panel-heading">
            <div>
              <span className="step">01</span>
              <h2>Video</h2>
            </div>
            <span className="hint">MP4 · MOV · MKV · WEBM</span>
          </div>

          <button
            className={`drop-zone ${videoPath ? "has-file" : ""}`}
            type="button"
            onClick={chooseVideo}
          >
            <div className="drop-icon">{videoPath ? "✓" : "＋"}</div>
            {videoPath ? (
              <>
                <strong>{fileName(videoPath)}</strong>
                <span>{videoPath}</span>
              </>
            ) : (
              <>
                <strong>Choose a video</strong>
                <span>Pick a file from this Windows PC</span>
              </>
            )}
          </button>

          <div className="panel-heading script-heading">
            <div>
              <span className="step">02</span>
              <h2>Commentary script</h2>
            </div>
            <span className="hint">{script.length} chars</span>
          </div>

          <textarea
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder="比如：不是哥们，这猴子是真没拿自己当外人。上来先把游客的可乐抢了……"
          />

          <div className="render-status">
            <div>
              <span>Status</span>
              <strong>{status}</strong>
            </div>
            {outputPath && (
              <div className="output-path">
                <span>Output</span>
                <code>{outputPath}</code>
              </div>
            )}
          </div>
        </div>

        <aside className="panel settings-panel">
          <div className={`runtime-card ${runtime?.portableReady ? "runtime-ready" : ""}`}>
            <div className="runtime-copy">
              <span className="runtime-kicker">LOCAL AI</span>
              <strong>
                {runtime?.portableReady
                  ? "Portable runtime ready"
                  : runtime?.developmentReady
                    ? "Development runtime ready"
                    : "AI runtime setup required"}
              </strong>
              <small>
                {runtime?.dataDir
                  ? runtime.dataDir
                  : "Choose where models, Python and FFmpeg should live."}
              </small>
            </div>
            {!runtime?.portableReady && (
              <button
                className="runtime-setup"
                type="button"
                disabled={isBootstrapping}
                onClick={setupRuntime}
              >
                {isBootstrapping ? "Setting up…" : "Set up runtime"}
              </button>
            )}
          </div>

          <div className="panel-heading">
            <div>
              <span className="step">03</span>
              <h2>Voice & mix</h2>
            </div>
          </div>

          <label className="field-label">Mandarin voice preset</label>
          <div className="voice-grid">
            {voices.map((item) => (
              <button
                key={item.id}
                className={`voice-card ${voice === item.id ? "selected" : ""}`}
                onClick={() => setVoice(item.id)}
                type="button"
              >
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </div>
                <em>{item.tag}</em>
              </button>
            ))}
          </div>

          <div className="slider-row">
            <div className="slider-copy">
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

          <div className="slider-row">
            <div className="slider-copy">
              <span>Original audio</span>
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

          <div className="next-features">
            <div><span>Next</span><strong>Auto timing</strong></div>
            <div><span>Next</span><strong>Auto subtitles</strong></div>
            <div><span>Next</span><strong>Voice cloning / dialect styles</strong></div>
          </div>

          <div className="summary">
            <span>Selected voice</span>
            <strong>{selectedVoice.name}</strong>
            <small>Kokoro Mandarin · local inference</small>
          </div>

          <button className="generate" disabled={!canGenerate} type="button" onClick={generate}>
            {isGenerating ? "Generating…" : "Generate video"}
            <span>{isGenerating ? "•••" : "→"}</span>
          </button>
          <p className="generate-note">
            V0.1 uses Kokoro + FFmpeg locally. GPT-SoVITS is reserved for custom voice cloning and stronger style voices.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default App;
