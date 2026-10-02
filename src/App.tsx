import { useMemo, useState } from "react";
import "./App.css";

type VoicePreset = {
  id: string;
  name: string;
  description: string;
  tag: string;
};

const voices: VoicePreset[] = [
  { id: "comic-north", name: "东北吐槽", description: "快节奏、夸张、适合搞笑解说", tag: "Comedy" },
  { id: "story-male", name: "小明故事", description: "自然男声、叙事感强", tag: "Story" },
  { id: "documentary", name: "纪录片旁白", description: "沉稳、清晰、信息密度高", tag: "Narration" },
  { id: "bright-female", name: "轻快女声", description: "明亮、自然、适合生活内容", tag: "Lifestyle" },
];

function App() {
  const [video, setVideo] = useState<File | null>(null);
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(voices[0].id);
  const [speed, setSpeed] = useState(1.05);
  const [originalVolume, setOriginalVolume] = useState(24);
  const [subtitles, setSubtitles] = useState(true);
  const [autoTiming, setAutoTiming] = useState(true);

  const selectedVoice = useMemo(
    () => voices.find((item) => item.id === voice) ?? voices[0],
    [voice],
  );

  const canGenerate = Boolean(video && script.trim().length > 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">Q</div>
          <div>
            <strong>QuipDub</strong>
            <span>Local AI commentary studio</span>
          </div>
        </div>
        <div className="local-badge"><span /> Local only</div>
      </header>

      <section className="hero">
        <p className="eyebrow">WINDOWS · V0.1</p>
        <h1>Turn a clip and a script into a finished voiceover video.</h1>
        <p className="hero-copy">
          Your video stays on this computer. QuipDub generates narration locally,
          ducks the source audio, builds subtitles, and renders the final MP4.
        </p>
      </section>

      <section className="workspace">
        <div className="panel source-panel">
          <div className="panel-heading">
            <div>
              <span className="step">01</span>
              <h2>Video</h2>
            </div>
            <span className="hint">MP4 · MOV · MKV</span>
          </div>

          <label className={`drop-zone ${video ? "has-file" : ""}`}>
            <input
              type="file"
              accept="video/*"
              onChange={(event) => setVideo(event.target.files?.[0] ?? null)}
            />
            <div className="drop-icon">＋</div>
            {video ? (
              <>
                <strong>{video.name}</strong>
                <span>{(video.size / 1024 / 1024).toFixed(1)} MB · ready</span>
              </>
            ) : (
              <>
                <strong>Drop a video here</strong>
                <span>or click to choose from your computer</span>
              </>
            )}
          </label>

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
        </div>

        <aside className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="step">03</span>
              <h2>Voice & mix</h2>
            </div>
          </div>

          <label className="field-label">Voice preset</label>
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

          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={autoTiming}
                onChange={(event) => setAutoTiming(event.target.checked)}
              />
              <span>
                <strong>Auto timing</strong>
                <small>Split and fit narration to the clip</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={subtitles}
                onChange={(event) => setSubtitles(event.target.checked)}
              />
              <span>
                <strong>Auto subtitles</strong>
                <small>Burn synchronized captions into export</small>
              </span>
            </label>
          </div>

          <div className="summary">
            <span>Selected voice</span>
            <strong>{selectedVoice.name}</strong>
            <small>Local inference · no upload</small>
          </div>

          <button className="generate" disabled={!canGenerate} type="button">
            Generate video
            <span>→</span>
          </button>
          <p className="generate-note">
            V0.1 target: GPT-SoVITS + FFmpeg, packaged as a Windows local engine.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default App;
