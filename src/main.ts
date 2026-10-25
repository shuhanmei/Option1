/**
 * Application entry point and orchestration. Suggested reading order:
 * start prepares resources -> draw requests frames -> onResult extracts fingertips -> HoverEngine confirms input
 * -> NoteOwners emits note events -> PianoAudio plays sound; draw updates the display.
 * See core.ts for interaction rules, tracking.ts for camera communication, and audio.ts for sound.
 */
import "./style.css";
import { PianoAudio } from "./audio";
import { Lesson } from "./lesson";
import { SongPlayer } from "./song-player";
import {
  songSection,
  readHistory,
  HISTORY_KEY,
  type PracticeRecord,
} from "./practice";
import { SONGS, noteName, practiceNotes, validateSong } from "./songs";
import { CameraTracker, cameraError, type TrackingResult } from "./tracking";
import {
  makeKeys,
  hitKey,
  mapPoint,
  HoverEngine,
  NoteOwners,
  HandTracker,
  readSettings,
  DEFAULT_SETTINGS,
  type Settings,
  type Point,
  type PianoKey,
} from "./core";

const icon = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v10h3V4m5 0v10h-3V4M8 14v6m8-6v6" stroke="currentColor" stroke-width="1.5"/></svg>`;
// Build the page before binding controls. Video and canvas share the performance stage.
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<header class="header"><a class="brand" href="./" aria-label="Air Piano Home"><span class="brand-icon">${icon}</span>AIR PIANO<span class="brand-divider"></span><span class="brand-cn">At Your Fingertips</span></a><div class="header-right"><span class="local-label"><i></i> Video stays on your device</span><button class="help-button" id="help">How to play <span>↗</span></button></div></header>
<main>
  <section class="intro"><div><div class="eyebrow"><span>INTERACTIVE SOUND EXPERIMENT</span><span class="edition">VOL. 01</span></div><h1>Give air <span>a melody.</span></h1><p>Reach out and hover your fingertips over the keys. Turn every movement into music.</p></div><div class="intro-mark" aria-hidden="true"><span>Two hands. One octave.</span><b>Endless melodies.</b><svg viewBox="0 0 100 36"><path d="M0 18h10l6-13 8 26L34 7l8 20 9-13 7 8h10l7-15 9 22 7-11h9"/></svg></div></section>
  <section class="learning" aria-label="Song library and note practice">
    <div class="learning-heading"><div><span class="eyebrow">PLAY · LEARN · REPEAT</span><h2>Start with a melody.</h2></div><div class="mode-switch" role="group" aria-label="Play mode"><button id="free-mode" aria-pressed="true">Free play</button><button id="practice-mode" aria-pressed="false">Song practice</button></div></div>
    <div id="song-library" hidden><p class="learning-hint">Choose a beginner song and follow the blue arrow, one note at a time. Play at your own pace.</p>
      <div class="song-filters"><label>Search songs<input id="song-search" type="search" placeholder="Enter a song title" /></label><label>Level<select id="song-level"><option value="all">All levels</option><option value="Beginner">Beginner</option><option value="Basic">Basic</option></select></label><label>Range<select id="song-range"><option value="all">All ranges</option><option value="low">C4–G4</option><option value="high">Includes C5</option></select></label></div>
      <div class="song-grid" id="song-grid"></div><p id="song-empty" hidden>No songs match. Try different filters.</p><p class="song-source" id="song-source"></p></div>
    <details id="history-panel" hidden><summary id="history-summary">Practice history</summary><p class="learning-hint">Saved only in this browser. Stores up to 50 sessions and shows the latest 10. Results compare the same song and note range. Clear anytime.</p><p id="history-stats"></p><ol id="history-list"></ol><button id="history-clear" class="secondary">Clear history</button></details>
  </section>
  <div class="workspace">
    <section class="instrument" aria-label="Virtual piano">
      <section id="lesson-panel" class="lesson-panel" aria-label="Practice guide" hidden>
        <div class="lesson-top"><div><span id="lesson-title"></span><strong id="lesson-target">Ready to begin</strong></div><span id="lesson-progress">0 / 0</span></div>
        <progress id="lesson-bar" value="0" max="1" aria-label="Practice progress"></progress>
        <div id="lesson-upcoming" class="upcoming" aria-label="Upcoming notes"></div>
        <details id="practice-options"><summary id="practice-scope">Practice range and preview speed</summary><div class="practice-fields"><label>First note<input id="section-start" type="number" min="1" value="1" /></label><label>Last note<input id="section-end" type="number" min="1" value="42" /></label><button id="section-apply">Apply range</button><button id="section-full">Full song</button><label>Preview speed<select id="listen-speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></label><label class="loop-control"><input id="section-loop" type="checkbox" />Loop after finishing and releasing all keys</label></div><p class="field-hint">Note numbers exclude rests. Changing the range restarts practice. Preview uses the same range.</p></details>
        <p id="lesson-feedback" role="status" aria-live="polite"></p>
        <div class="lesson-actions"><button class="primary" id="lesson-start">Start practice</button><button class="secondary" id="lesson-pause" disabled>Pause practice</button><button class="secondary" id="song-listen">Preview song</button><button class="secondary" id="lesson-library">Back to library</button></div>
        <div id="lesson-result" class="lesson-result" hidden></div>
        <button id="lesson-retry" class="secondary" hidden>Practice tricky section</button>
        <p class="lesson-rule">The blue outline and arrow mark your target; green shows sounding notes. Release after each note. Timing and rests apply only to previews; practice does not score rhythm.</p>
      </section>
      <div class="stage" id="stage">
        <video id="video" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="canvas" aria-label="Virtual piano keys. Enable mouse playback to play."></canvas>
        <div class="stage-top"><span class="stage-label"><i id="live-dot"></i><span id="stage-state">Your stage</span></span><span class="octave-label">C4 — C5 <span>／</span> 13 KEYS</span></div>
        <div class="stage-message" id="stage-message"><div class="camera-symbol"><svg viewBox="0 0 48 48" fill="none"><rect x="8" y="12" width="32" height="26" rx="8" stroke="currentColor" stroke-width="1.5"/><circle cx="24" cy="25" r="7" stroke="currentColor" stroke-width="1.5"/><path d="m17 12 3-5h8l3 5" stroke="currentColor" stroke-width="1.5"/></svg></div><h2 id="message-title">Your hands. Your next melody.</h2><p id="message-description">Turn on your camera and start playing in the air.</p></div>
        <div class="stage-bottom"><span><i></i> Mirrored view · Hover to play</span><span id="hand-count">Waiting for your hands</span></div>
      </div>
      <div class="transport"><div class="transport-buttons"><button class="primary" id="start"><span>◉</span> Start playing</button><button class="secondary" id="pause" disabled>Ⅱ Pause</button><button class="icon-button" id="stop" disabled aria-label="End session">■</button></div><div class="current-note"><span>Now playing</span><strong id="notes" aria-live="polite">—</strong></div></div>
      <div class="instrument-caption"><span class="tiny-dot"></span><span id="caption">No screen contact needed. Move your fingertips into the keys on screen.</span></div>
      <div id="input-feedback" class="input-feedback" role="status" aria-live="polite">Start the camera or enable mouse playback.</div>
      <div class="reach-check"><button id="reach-start" class="secondary">Check key reach</button><span id="reach-status">With the camera on, use your fingertip to check the left, middle, and right keys.</span></div>
      <details id="diagnostics"><summary>Trigger diagnostics (optional)</summary><pre id="diagnostic-data"></pre><p class="field-hint">Shows session counters and trigger reasons. No video is recorded or uploaded.</p></details>
      <div id="notice" class="notice" role="status" hidden></div>
      <div class="accessible-keys" aria-label="Keyboard controls: focus a note, then press Space or Enter"></div>
    </section>
    <aside class="panel" aria-label="Session settings">
      <div class="panel-heading"><span>Session settings</span><span class="panel-tag">YOUR SESSION</span></div>
      <div class="statuses" aria-label="System status"><div><i id="camera-dot"></i><span>Camera</span><b id="camera-status">Off</b></div><div><i id="model-dot"></i><span>Hand tracking</span><b id="model-status">Not loaded</b></div><div><i id="audio-dot"></i><span>Piano sound</span><b id="audio-status">Not loaded</b></div></div>
      <div class="setting-block"><div class="field-title"><label for="volume">Volume</label><output id="volume-value"></output></div><input id="volume" type="range" min="0" max="100" step="1" aria-label="Volume"/><div class="range-ends"><span>Softer</span><span>Louder</span></div></div>
      <div class="setting-block"><div class="field-title"><label for="dwell">Hover delay</label><output id="dwell-value"></output></div><input id="dwell" type="range" min="50" max="300" step="10" aria-label="Hover delay"/><p class="field-hint">Hover to play. A longer delay reduces accidental notes.</p></div>
      <div class="setting-block"><div class="field-title"><span>Active fingers</span></div><div class="segmented" role="group" aria-label="Active fingers"><button id="index-fingers">Index fingers <small>Recommended</small></button><button id="all-fingers">All fingers <small>Chords</small></button></div><label class="switch-row" for="skeleton"><span>Show hand skeleton</span><input id="skeleton" type="checkbox" role="switch"/></label></div>
      <details class="layout-settings"><summary>Keyboard layout <span>Position and size</span></summary><div class="layout-fields">${[
        ["width", "Key width", 50, 96],
        ["height", "Key height", 18, 45],
        ["x", "Horizontal position", 0, 100],
        ["y", "Vertical position", 0, 100],
      ]
        .map(
          ([id, label, min, max]) =>
            `<div><div class="field-title"><label for="layout-${id}">${label}</label><output id="layout-${id}-value"></output></div><input id="layout-${id}" type="range" min="${min}" max="${max}" step="1"/></div>`,
        )
        .join("")}</div></details>
      <button class="reset-button" id="reset">↺ Reset settings</button>
      <div class="performance"><span><i></i> <span id="fps">—</span> FPS</span><span>Inference <b id="inference">—</b> ms</span></div>
    </aside>
  </div>
  <section class="guide" aria-label="Quick start"><div class="guide-heading"><span class="eyebrow">A LITTLE GUIDANCE</span><h2>Three steps to your first melody.</h2></div><div class="guide-step"><b>01</b><div><h3>Set the stage</h3><p>Allow camera access and keep both hands clearly visible.</p></div></div><div class="guide-step"><b>02</b><div><h3>Find your keys</h3><p>Watch the mirrored view and move a fingertip into a key.</p></div></div><div class="guide-step"><b>03</b><div><h3>Hover, then play</h3><p>Hold briefly to play. Move away and return to play again.</p></div></div></section>
</main>
<footer><span>AIR PIANO <span class="footer-dot">·</span> At Your Fingertips</span><span>No camera? <button id="demo">Enable mouse playback ↗</button></span><span>Feel the music in your hands.</span></footer>
<dialog id="help-dialog"><div class="dialog-header"><span class="eyebrow">GET STARTED</span><button id="close-help" aria-label="Close guide">×</button></div><h2>Bring your fingertips to the keys.</h2><ol><li>Keep your camera steady in even lighting, with your palms and fingertips fully visible.</li><li>Click Start playing, allow camera access, and wait for tracking and piano sounds to load.</li><li>Move your index finger in the mirrored view. Hover its marker over a key to play. Keep your hands in the air; there is no need to touch the screen.</li><li>Move away and return to repeat a note. All fingers enables chords. Adjust the key size and position in Keyboard layout.</li></ol><p>Overlapping fingers, fast movement, and low light can affect tracking. Start with index fingers. Switching away automatically pauses playback.</p><div class="dialog-credit">Piano sound: Salamander Grand Piano · Alexander Holm<br><a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a> · Samples distributed by Tone.js Audio and transposed to each pitch.<br>Video stays on your device. Nothing is uploaded or recorded.</div></dialog>`;

// Look up elements by ID. The generic type only helps TypeScript and creates no UI.
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const audio = new PianoAudio();
let settings: Settings;
try {
  settings = readSettings(localStorage.getItem("air-piano:v1"));
} catch {
  settings = structuredClone(DEFAULT_SETTINGS);
}
audio.setVolume(settings.volume);
// Session state controls buttons and frame submission. Pause retains the camera; end releases it.
let mode: "stopped" | "starting" | "running" | "paused" | "stopping" =
  "stopped";
// Increment on start/end to invalidate asynchronous results from older sessions.
let token = 0;
let width = 1000,
  height = 750;
/** Keep keys inside the visible video content so fingertips can reach every key. */
function keyboardGeometry(): PianoKey[] {
  const sw = video.videoWidth || 640,
    sh = video.videoHeight || 480;
  const top = mapPoint({ x: 0, y: 0 }, sw, sh, width, height, false);
  const bottom = mapPoint({ x: 1, y: 1 }, sw, sh, width, height, false);
  return makeKeys(bottom.x - top.x, bottom.y - top.y, settings.layout).map(
    (k) => ({ ...k, x: k.x + top.x, y: k.y + top.y }),
  );
}
let keys = keyboardGeometry();
let renderHands: { id: number; points: Point[] }[] = [];
let lastResult = 0,
  frameTimes: number[] = [];
let pointerNote: number | undefined;
const pointers = new Set<number>();
const keyboardHeld = new Set<string>();
let demoLoading = false;
let demoToken = 0;
const lesson = new Lesson();
let practicing = false;
let selectedSong = SONGS[0];
let lessonLoading = false;
let lessonGeneration = 0;
let libraryOpen = true;
let sectionStart = 0,
  sectionEnd = practiceNotes(selectedSong).length;
let recorded = false,
  allowLoop = false,
  clearingNotes = false;
let history: PracticeRecord[] = [];
try {
  history = readHistory(localStorage.getItem(HISTORY_KEY), SONGS);
} catch {
  /* Practice remains available when storage is unavailable. */
}
let staleResults = 0,
  lastInference = 0,
  lastFrameAge = 0;
let calibration: number | undefined;
const reachTargets = [60, 67, 72];
const songPlayer = new SongPlayer(audio, renderLesson);
// Connect note ownership events to audio, current note labels, and accessible key state.
const noteOwners = new NoteOwners((event) => {
  if (event.type === "on") audio.on(event.midi);
  else audio.off(event.midi);
  // Only user input reaches this path. SongPlayer schedules automatic previews separately.
  lesson.input(event);
  if (
    calibration !== undefined &&
    event.type === "on" &&
    event.midi === reachTargets[calibration] &&
    [...hover.states.values()].some(
      (state) => state.active && state.key?.midi === event.midi,
    )
  ) {
    calibration++;
    if (calibration === reachTargets.length) {
      calibration = undefined;
      $("reach-status").textContent =
        "Check complete: all three keys are reachable. Your current layout is retained.";
      $("reach-start").textContent = "Check reach again";
    } else
      $("reach-status").textContent =
        `Move away, then use your fingertip to play ${noteName(reachTargets[calibration])}. Adjust Keyboard layout if needed.`;
  }
  saveCompletion();
  if (
    !clearingNotes &&
    allowLoop &&
    lesson.state === "completed" &&
    $<HTMLInputElement>("section-loop").checked &&
    !noteOwners.active.size
  ) {
    lesson.start(currentPracticeSong());
    recorded = false;
  }
  renderLesson();
  updateUI();
  const names = [...noteOwners.active]
    .sort((a, b) => a - b)
    .map((m) => keys.find((k) => k.midi === m)?.note)
    .filter(Boolean);
  $("notes").textContent = names.join(" · ") || "—";
  document
    .querySelectorAll<HTMLButtonElement>(".accessible-keys button")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(noteOwners.active.has(Number(b.dataset.midi))),
      ),
    );
});
// Associate hands, confirm fingertip hover, then let noteOwners manage sounding notes.
const hover = new HoverEngine(noteOwners, settings.dwell);
const associator = new HandTracker();
const tracker = new CameraTracker(video, onResult, (error) => {
  void failSession(error);
});
function showNotice(message: string, error = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("error", error);
}
function status(
  id: "camera" | "model" | "audio",
  label: string,
  state: "idle" | "loading" | "ready" | "error" = "idle",
) {
  $(`${id}-status`).textContent = label;
  $(`${id}-dot`).className = state;
}
/** Release every input source and clear hand, mouse, and keyboard state. */
function clearNotes() {
  clearingNotes = true;
  hover.reset();
  noteOwners.reset();
  audio.silence();
  associator.reset();
  renderHands = [];
  pointers.clear();
  keyboardHeld.clear();
  pointerNote = undefined;
  clearingNotes = false;
}
/** Reflect state in the UI without starting camera, model, or audio resources. */
function updateUI() {
  $("start").toggleAttribute(
    "disabled",
    mode !== "stopped" || lessonLoading || demoLoading,
  );
  $("pause").toggleAttribute(
    "disabled",
    mode !== "running" &&
      mode !== "paused" &&
      !lesson.active &&
      lesson.state !== "paused",
  );
  $("pause").textContent =
    mode === "paused" || lesson.state === "paused" ? "▷ Resume" : "Ⅱ Pause";
  $("stop").toggleAttribute(
    "disabled",
    (mode === "stopped" && !audio.ready && !lessonLoading) ||
      mode === "stopping",
  );
  $("start").innerHTML =
    mode === "starting"
      ? '<span class="spinner"></span> Getting ready'
      : "<span>◉</span> Start playing";
  $("demo").toggleAttribute(
    "disabled",
    demoLoading || lessonLoading || mode === "starting" || mode === "stopping",
  );
  $("stage-message").hidden =
    mode === "running" ||
    (practicing && (lesson.state !== "idle" || songPlayer.playing));
  $("video").classList.toggle(
    "visible",
    mode === "running" || mode === "paused",
  );
  $("live-dot").classList.toggle("live", mode === "running");
  $("stage-state").textContent = {
    stopped: "Your stage",
    starting: "Getting ready",
    running: "LIVE · Playing",
    paused: "Paused",
    stopping: "Ending session",
  }[mode];
  if (mode === "starting") {
    $("message-title").textContent = "Getting your stage ready.";
    $("message-description").textContent =
      "Allow camera access. The first load may take a moment.";
  }
  if (mode === "paused") {
    $("message-title").textContent = "Take a breath between melodies.";
    $("message-description").textContent =
      "Sound and tracking are paused. Your camera stays connected for a quick resume.";
  }
  if (mode === "stopped") {
    $("message-title").textContent = audio.ready
      ? "Make music with your mouse."
      : "Your hands. Your next melody.";
    $("message-description").textContent = audio.ready
      ? "Click the keys to play, or start the camera to use your hands."
      : "Turn on your camera and start playing in the air.";
  }
}
/** Wait for camera, model, and audio together. Any failure triggers cleanup. */
async function start() {
  if (mode !== "stopped" || demoLoading || lessonLoading) return;
  suspendLearning();
  const current = ++token;
  demoToken++;
  mode = "starting";
  clearNotes();
  showNotice("");
  updateUI();
  status("camera", "Awaiting permission", "loading");
  status("model", "Loading", "loading");
  status("audio", "Preparing", "loading");
  try {
    // Prepare all three resources concurrently; switch to running only after all succeed.
    await Promise.all([
      tracker.openCamera().then(() => {
        if (current === token) status("camera", "On", "ready");
      }),
      tracker.initModel().then(() => {
        if (current === token) status("model", "Ready", "ready");
      }),
      audio
        .prepare((n) => {
          if (current === token) status("audio", `Samples ${n}/5`, "loading");
        })
        .then(() => {
          if (current === token) status("audio", "Ready", "ready");
        }),
    ]);
    if (current !== token) return;
    if (!audio.ready)
      throw new Error("Your browser suspended audio. Please try again.");
    if (document.hidden) {
      await end();
      return;
    }
    mode = "running";
    resize();
    frameTimes = [];
    lastResult = 0;
    updateUI();
    $("caption").textContent =
      "Hover your fingertip marker over a key to play. Move away to play again.";
  } catch (e) {
    if (current !== token) return;
    await end();
    showNotice(cameraError(e), true);
  }
}
/** Invalidate old tasks, then release audio, worker, and video resources and reset the UI. */
async function end() {
  suspendLearning();
  const endingToken = ++token;
  ++demoToken;
  demoLoading = false;
  mode = "stopping";
  clearNotes();
  tracker.stop();
  updateUI();
  await audio.close();
  if (endingToken !== token) return;
  mode = "stopped";
  status("camera", "Off");
  status("model", "Not loaded");
  status("audio", "Not loaded");
  $("fps").textContent = "—";
  $("inference").textContent = "—";
  $("hand-count").textContent = "Waiting for your hands";
  $("demo").textContent = "Enable mouse playback ↗";
  $("caption").textContent =
    "No screen contact needed. Move your fingertips into the keys on screen.";
  updateUI();
}
async function failSession(error: Error) {
  if (mode === "stopped" || mode === "stopping") return;
  await end();
  status("model", "Stopped", "error");
  showNotice(error.message, true);
}
// Pause clears input but keeps the camera. draw submits no frames while paused.
function pause() {
  if (mode !== "running") return;
  suspendLearning();
  mode = "paused";
  clearNotes();
  $("hand-count").textContent = "Playing paused";
  status("camera", "Connected", "ready");
  status("model", "Paused");
  updateUI();
}
// Resume audio and clear old finger state so each key requires fresh hover confirmation.
async function resume() {
  if (lesson.state === "paused" && practicing) {
    await prepareLearning("resume");
    return;
  }
  if (mode !== "paused") return;
  const current = token;
  try {
    await audio.prepare();
    if (mode !== "paused" || token !== current || document.hidden) return;
    clearNotes();
    mode = "running";
    frameTimes = [];
    lastResult = 0;
    status("camera", "On", "ready");
    status("model", "Ready", "ready");
    updateUI();
  } catch (e) {
    showNotice(cameraError(e), true);
  }
}
/** Tracking result pipeline: associate hands, map coordinates, select fingertips, confirm hover. */
function onResult(result: TrackingResult) {
  // Ignore stopped/paused input and results older than 200 ms to prevent stale notes.
  if (mode !== "running") return;
  lastInference = result.ms;
  lastFrameAge = performance.now() - result.timestamp;
  if (lastFrameAge > 200) {
    staleResults++;
    return;
  }
  lastResult = performance.now();
  // Count accepted tracking results in the last second, rather than canvas refreshes.
  frameTimes.push(lastResult);
  frameTimes = frameTimes.filter((t) => lastResult - t < 1000);
  $("fps").textContent = String(frameTimes.length);
  $("inference").textContent = result.ms.toFixed(0);
  $("hand-count").textContent = result.hands.length
    ? `${result.hands.length} hands detected`
    : "Put your hands in view";
  const tracked = associator.update(result.hands, lastResult);
  renderHands = tracked.map((t) => ({
    id: t.id,
    points: t.points.map((p) =>
      mapPoint(
        p,
        video.videoWidth || 640,
        video.videoHeight || 480,
        width,
        height,
      ),
    ),
  }));
  // MediaPipe fingertip indices: thumb 4, index 8, middle 12, ring 16, little finger 20.
  const tips = settings.fingers === "all" ? [4, 8, 12, 16, 20] : [8];
  // Combine hand ID and landmark index so each fingertip has an independent timer.
  if (
    lessonLoading ||
    songPlayer.playing ||
    (lesson.state === "paused" && calibration === undefined)
  )
    return;
  hover.update(
    renderHands.flatMap((hand) =>
      tips.map((tip) => ({
        id: `hand:${hand.id}:${tip}`,
        point: hand.points[tip],
      })),
    ),
    keys,
    lastResult,
  );
}
/** Save settings in this browser; JSON.stringify converts the object to storage text. */
function persist() {
  try {
    localStorage.setItem("air-piano:v1", JSON.stringify(settings));
  } catch {
    showNotice(
      "Your browser blocked saving settings. You can still use this session.",
    );
  }
}
function currentPracticeSong() {
  return songSection(selectedSong, sectionStart, sectionEnd);
}

/** Save each completion once; redraws and the final release must not duplicate it. */
function saveCompletion() {
  if (lesson.state !== "completed" || recorded) return;
  recorded = true;
  history = [
    {
      songId: selectedSong.id,
      at: Date.now(),
      start: sectionStart,
      end: sectionEnd,
      mistakes: lesson.mistakes,
      firstTry: lesson.firstTry,
      elapsedMs: lesson.elapsedMs,
    },
    ...history,
  ].slice(0, 50);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    showNotice(
      "Unable to save practice history. Your current result is still available.",
    );
  }
  renderHistory();
}
function renderHistory() {
  $("history-summary").textContent =
    `Practice history (${history.length} sessions)`;
  const matching = history.filter(
    (row) =>
      row.songId === selectedSong.id &&
      row.start === sectionStart &&
      row.end === sectionEnd,
  );
  const accuracy = (row: PracticeRecord) =>
    Math.round((row.firstTry / (row.end - row.start)) * 100);
  $("history-stats").textContent = matching.length
    ? `${selectedSong.title} · Sessions for this range: ${matching.length}; latest ${accuracy(matching[0])}%; best ${Math.max(...matching.map(accuracy))}%.`
    : "No completed sessions for this song and range yet.";
  $("history-list").replaceChildren(
    ...history.slice(0, 10).map((row) => {
      const item = document.createElement("li");
      item.textContent = `${new Date(row.at).toLocaleString("en-US")} · ${SONGS.find((song) => song.id === row.songId)!.title} Notes ${row.start + 1}–${row.end} · First try ${accuracy(row)}% · Errors ${row.mistakes} times · ${(row.elapsedMs / 1000).toFixed(1)}s`;
      return item;
    }),
  );
  $("history-clear").toggleAttribute("disabled", !history.length);
}
function syncSection() {
  const total = practiceNotes(selectedSong).length;
  $<HTMLInputElement>("section-start").value = String(sectionStart + 1);
  $<HTMLInputElement>("section-end").value = String(sectionEnd);
  $<HTMLInputElement>("section-start").max = $<HTMLInputElement>(
    "section-end",
  ).max = String(total);
  renderHistory();
}
function filterSongs() {
  const search = $<HTMLInputElement>("song-search").value.trim().toLowerCase();
  const level = $<HTMLSelectElement>("song-level").value;
  const range = $<HTMLSelectElement>("song-range").value;
  let visible = 0;
  document
    .querySelectorAll<HTMLButtonElement>("[data-song]")
    .forEach((button) => {
      const song = SONGS.find((song) => song.id === button.dataset.song)!;
      const notes = practiceNotes(song);
      const show =
        song.title.toLowerCase().includes(search) &&
        (level === "all" || song.difficulty.startsWith(level)) &&
        (range === "all" ||
          (range === "low" ? Math.max(...notes) <= 67 : notes.includes(72)));
      button.hidden = !show;
      if (show) visible++;
    });
  $("song-empty").hidden = visible > 0;
}
/** Render controller state without inferring practice progress from DOM text or colors. */
function renderLesson() {
  $("song-library").hidden = !practicing || !libraryOpen;
  $("history-panel").hidden = !practicing;
  document.body.classList.toggle(
    "focused-practice",
    practicing && !libraryOpen,
  );
  $("lesson-panel").hidden = !practicing;
  $("free-mode").setAttribute("aria-pressed", String(!practicing));
  $("practice-mode").setAttribute("aria-pressed", String(practicing));
  document
    .querySelectorAll<HTMLButtonElement>("[data-song]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.song === selectedSong.id),
      );
    });
  const error = validateSong(selectedSong);
  const notes = practiceNotes(currentPracticeSong());
  const started = lesson.state !== "idle";
  $("lesson-title").textContent = selectedSong.title;
  $("practice-scope").textContent =
    `Notes ${sectionStart + 1}–${sectionEnd} / total ${practiceNotes(selectedSong).length} notes · Range and preview speed`;
  $("song-source").textContent =
    `${selectedSong.source} · ${selectedSong.bpm} BPM (preview tempo)`;
  $("lesson-target").textContent = songPlayer.playing
    ? `Previewing · ${songPlayer.current === undefined ? "Ready / Rest" : noteName(songPlayer.current)}`
    : lesson.state === "completed"
      ? "Practice complete!"
      : lesson.target === undefined
        ? "Ready to begin"
        : `▼ Play ${noteName(lesson.target)}`;
  $("lesson-progress").textContent = `${lesson.index} / ${notes.length}`;
  const bar = $<HTMLProgressElement>("lesson-bar");
  bar.max = notes.length || 1;
  bar.value = lesson.index;
  $("lesson-upcoming").textContent = `Up next: ${
    notes
      .slice(started ? lesson.index + 1 : 0, started ? lesson.index + 6 : 5)
      .map(noteName)
      .join(" → ") || "—"
  }`;
  $("lesson-feedback").textContent =
    error ||
    (lessonLoading
      ? "Loading piano sounds…"
      : songPlayer.playing
        ? "Listen to the melody first. Preview does not count toward practice. Stop anytime."
        : lesson.state === "release"
          ? "Correct! Release all keys before playing the next note."
          : lesson.state === "paused"
            ? "Practice paused. Your progress is saved. Resume and play the target key again."
            : lesson.state === "completed"
              ? "Song complete! Practice again or choose another song."
              : lesson.wrong && lesson.wrong.until > performance.now()
                ? `Try again. Play ${noteName(lesson.target!)}.`
                : lesson.state === "playing"
                  ? "Follow the blue arrow. Play the correct note to continue."
                  : "Use the camera, or start with your mouse or accessible note buttons.");
  $("lesson-start").textContent = started ? "Restart" : "Start practice";
  const busy =
    lessonLoading || demoLoading || mode === "starting" || mode === "stopping";
  $("lesson-start").toggleAttribute("disabled", busy || !!error);
  $("song-listen").toggleAttribute("disabled", busy || !!error);
  $("song-listen").textContent = songPlayer.playing
    ? "Stop preview"
    : "Preview song";
  $("lesson-pause").textContent =
    lesson.state === "paused" ? "Resume practice" : "Pause practice";
  $("lesson-pause").toggleAttribute(
    "disabled",
    busy || (!lesson.active && lesson.state !== "paused"),
  );
  $("lesson-result").hidden = lesson.state !== "completed";
  $("lesson-retry").hidden =
    lesson.state !== "completed" || !lesson.mistakeSteps.size;
  if (lesson.state === "completed") {
    $("lesson-result").textContent =
      `Completed ${lesson.index} notes · Wrong notes ${lesson.mistakes} times · First-try accuracy ${lesson.accuracy}% · Active time ${(lesson.elapsedMs / 1000).toFixed(1)} s (rhythm is not scored)`;
  }
  $("stage-message").hidden =
    mode === "running" || (practicing && (started || songPlayer.playing));
}

/** Invalidate asynchronous work and pause assessment before releasing notes. */
function suspendLearning() {
  allowLoop = false;
  if (calibration !== undefined) {
    calibration = undefined;
    $("reach-status").textContent = "Reach check paused. You can restart it.";
    $("reach-start").textContent = "Check key reach";
  }
  ++lessonGeneration;
  lessonLoading = false;
  lesson.pause();
  songPlayer.stop();
  clearNotes();
  renderLesson();
  updateUI();
}
function resetLesson() {
  suspendLearning();
  lesson.reset();
  recorded = false;
  renderLesson();
  updateUI();
}

/** Enable audio from a click; generation checks prevent old loads from restarting an earlier song. */
async function prepareLearning(action: "start" | "resume" | "listen") {
  if (
    lessonLoading ||
    demoLoading ||
    mode === "starting" ||
    mode === "stopping"
  )
    return;
  const error = validateSong(selectedSong);
  if (error) {
    showNotice(error, true);
    return;
  }
  suspendLearning();
  if (action !== "resume") lesson.reset();
  const generation = ++lessonGeneration;
  const song = currentPracticeSong();
  lessonLoading = true;
  status("audio", "Preparing", "loading");
  renderLesson();
  updateUI();
  try {
    await audio.prepare();
    if (generation !== lessonGeneration || document.hidden) return;
    if (!audio.ready)
      throw new Error(
        "Your browser suspended audio. Click again to enable it.",
      );
    // Resume the camera session before the lesson, using the same audio authorization.
    if (mode === "paused") {
      mode = "running";
      frameTimes = [];
      lastResult = 0;
      status("camera", "On", "ready");
      status("model", "Ready", "ready");
    }
    status("audio", "Ready", "ready");
    clearNotes();
    if (action === "listen")
      songPlayer.play(song, Number($<HTMLSelectElement>("listen-speed").value));
    else if (action === "resume") lesson.resume();
    else {
      lesson.start(song);
      recorded = false;
    }
    allowLoop = action !== "listen";
    libraryOpen = false;
    showNotice("");
  } catch (e) {
    if (generation !== lessonGeneration) return;
    songPlayer.stop();
    status("audio", "Loading failed", "error");
    showNotice(cameraError(e), true);
  } finally {
    if (generation === lessonGeneration) {
      lessonLoading = false;
      renderLesson();
      updateUI();
    } else if (!lessonLoading && !demoLoading && mode === "stopped") {
      // Changing songs cancels startup intent but can reuse samples; do not leave a loading status behind.
      status(
        "audio",
        audio.ready ? "Ready" : "Not loaded",
        audio.ready ? "ready" : "idle",
      );
      updateUI();
    }
  }
}

$("song-grid").innerHTML = SONGS.map((song) => {
  const pitches = practiceNotes(song);
  return `<button class="song-card" data-song="${song.id}" aria-pressed="false"><span>${song.difficulty}</span><strong>${song.title}</strong><small>${song.description}</small><em>${pitches.length} notes · ${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}</em></button>`;
}).join("");
document
  .querySelectorAll<HTMLButtonElement>("[data-song]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      resetLesson();
      selectedSong = SONGS.find((song) => song.id === button.dataset.song)!;
      sectionStart = 0;
      sectionEnd = practiceNotes(selectedSong).length;
      syncSection();
      renderLesson();
    });
  });
$("practice-mode").addEventListener("click", () => {
  practicing = true;
  libraryOpen = true;
  renderLesson();
});
$("free-mode").addEventListener("click", () => {
  resetLesson();
  practicing = false;
  renderLesson();
  updateUI();
});
$("lesson-start").addEventListener(
  "click",
  () => void prepareLearning("start"),
);
$("song-listen").addEventListener("click", () => {
  if (songPlayer.playing) {
    songPlayer.stop();
    clearNotes();
    renderLesson();
    updateUI();
  } else void prepareLearning("listen");
});
$("lesson-pause").addEventListener("click", () => {
  togglePause();
});
$("lesson-library").addEventListener("click", () => {
  resetLesson();
  libraryOpen = true;
  renderLesson();
  $("song-grid").scrollIntoView({ block: "center", behavior: "smooth" });
});
for (const id of ["song-search", "song-level", "song-range"])
  $(id).addEventListener("input", filterSongs);
$("section-apply").addEventListener("click", () => {
  const start = Number($<HTMLInputElement>("section-start").value) - 1;
  const end = Number($<HTMLInputElement>("section-end").value);
  try {
    songSection(selectedSong, start, end);
  } catch {
    showNotice(
      "Invalid range: use whole note numbers within the song, with start no greater than end.",
      true,
    );
    return;
  }
  resetLesson();
  sectionStart = start;
  sectionEnd = end;
  syncSection();
  renderLesson();
  showNotice("");
});
$("section-full").addEventListener("click", () => {
  resetLesson();
  sectionStart = 0;
  sectionEnd = practiceNotes(selectedSong).length;
  syncSection();
  renderLesson();
});
$("lesson-retry").addEventListener("click", () => {
  const mistakes = [...lesson.mistakeSteps];
  if (!mistakes.length) return;
  const start = sectionStart + Math.max(0, Math.min(...mistakes) - 1);
  const end = Math.min(sectionEnd, sectionStart + Math.max(...mistakes) + 2);
  resetLesson();
  sectionStart = start;
  sectionEnd = end;
  syncSection();
  renderLesson();
  void prepareLearning("start");
});
$("listen-speed").addEventListener("change", () => {
  if (songPlayer.playing) {
    songPlayer.stop();
    renderLesson();
    showNotice(
      "Preview speed changed. Click Preview song to play from the start of this range.",
    );
  }
});
$("history-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
    history = [];
    renderHistory();
  } catch {
    showNotice(
      "Your browser blocked clearing history. Check site storage settings.",
      true,
    );
  }
});
$("reach-start").addEventListener("click", () => {
  if (calibration !== undefined) {
    suspendLearning();
    return;
  }
  if (mode !== "running") {
    showNotice("Start or resume camera playback before checking key reach.");
    return;
  }
  suspendLearning();
  calibration = 0;
  $("reach-start").textContent = "Stop reach check";
  $("reach-status").textContent =
    "Use a fingertip to play C4, then G4 and C5. Adjust Keyboard layout if needed.";
});
function togglePause() {
  // A reach check can pause the lesson alone. Resume it before considering camera state.
  if (lesson.state === "paused" && practicing) void prepareLearning("resume");
  else if (mode === "running") pause();
  else if (mode === "paused") void resume();
  else if (lesson.state === "paused") void prepareLearning("resume");
  else if (lesson.active) suspendLearning();
}

/** Copy settings into sliders, labels, and switches on startup or reset. */
function syncSettings() {
  $<HTMLInputElement>("volume").value = String(settings.volume);
  $("volume-value").textContent = `${settings.volume}%`;
  $<HTMLInputElement>("dwell").value = String(settings.dwell);
  $("dwell-value").textContent = `${settings.dwell} ms`;
  $<HTMLInputElement>("skeleton").checked = settings.skeleton;
  $("index-fingers").setAttribute(
    "aria-pressed",
    String(settings.fingers === "index"),
  );
  $("all-fingers").setAttribute(
    "aria-pressed",
    String(settings.fingers === "all"),
  );
  for (const prop of ["width", "height", "x", "y"] as const) {
    $<HTMLInputElement>(`layout-${prop}`).value = String(settings.layout[prop]);
    $(`layout-${prop}-value`).textContent = `${settings.layout[prop]}%`;
  }
}
// Layout, delay, or finger-mode changes invalidate old key ownership and hover timers.
function resetInteraction() {
  clearNotes();
  keys = keyboardGeometry();
  hover.dwell = settings.dwell;
}
// Update settings and input state before saving and refreshing controls. Volume needs no new geometry.
$("start").addEventListener("click", () => void start());
$("stop").addEventListener("click", () => void end());
$("pause").addEventListener("click", togglePause);
$("volume").addEventListener("input", () => {
  settings.volume = Number($<HTMLInputElement>("volume").value);
  audio.setVolume(settings.volume);
  syncSettings();
  persist();
});
$("dwell").addEventListener("input", () => {
  settings.dwell = Number($<HTMLInputElement>("dwell").value);
  resetInteraction();
  syncSettings();
  persist();
});
$("skeleton").addEventListener("change", () => {
  settings.skeleton = $<HTMLInputElement>("skeleton").checked;
  persist();
});
for (const type of ["index", "all"] as const)
  $(`${type}-fingers`).addEventListener("click", () => {
    settings.fingers = type;
    resetInteraction();
    syncSettings();
    persist();
  });
for (const prop of ["width", "height", "x", "y"] as const)
  $(`layout-${prop}`).addEventListener("input", () => {
    settings.layout[prop] = Number($<HTMLInputElement>(`layout-${prop}`).value);
    resetInteraction();
    syncSettings();
    persist();
  });
$("reset").addEventListener("click", () => {
  settings = structuredClone(DEFAULT_SETTINGS);
  resetInteraction();
  audio.setVolume(settings.volume);
  syncSettings();
  persist();
  showNotice("Default settings restored.");
});
// Mouse playback prepares audio alone, allowing use without a camera.
$("demo").addEventListener("click", async () => {
  if (lesson.state === "paused") {
    showNotice("Resume practice or switch to Free play first.");
    return;
  }
  if (mode === "paused") {
    showNotice("Resume or end the session before enabling mouse playback.");
    return;
  }
  if (mode === "starting" || mode === "stopping" || demoLoading) return;
  if (audio.ready) {
    showNotice("Piano sounds are ready. Click a key to play.");
    return;
  }
  const current = ++demoToken;
  demoLoading = true;
  $("start").setAttribute("disabled", "");
  $("demo").setAttribute("disabled", "");
  status("audio", "Preparing", "loading");
  try {
    await audio.prepare((n) => {
      if (current === demoToken) status("audio", `Samples ${n}/5`, "loading");
    });
    if (current !== demoToken) return;
    status("audio", "Ready", "ready");
    $("demo").textContent = "Mouse playback ready ♪";
    showNotice(
      "Piano ready. Hold a key to play and release to stop. You can also Tab to a note and press Space or Enter.",
    );
    $("stop").removeAttribute("disabled");
  } catch (e) {
    if (current === demoToken) {
      status("audio", "Loading failed", "error");
      showNotice(cameraError(e), true);
    }
  } finally {
    if (current === demoToken) {
      demoLoading = false;
      updateUI();
      if (audio.ready) $("stop").removeAttribute("disabled");
    }
  }
});
/** Convert browser pointer coordinates to canvas logical coordinates, accounting for display scaling. */
function pointerPosition(e: PointerEvent): Point {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * width) / r.width,
    y: ((e.clientY - r.top) * height) / r.height,
  };
}
canvas.addEventListener("pointermove", (e) => {
  const key = hitKey(keys, pointerPosition(e));
  pointerNote = key?.midi;
  canvas.style.cursor = key ? "pointer" : "default";
  if (pointers.has(e.pointerId))
    noteOwners.set(`pointer:${e.pointerId}`, key?.midi);
});
// Mouse/touch presses own notes directly; release on pointer up, cancellation, or exit.
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (
    calibration !== undefined ||
    songPlayer.playing ||
    lessonLoading ||
    lesson.state === "paused"
  )
    return;
  if (
    !audio.ready ||
    mode === "paused" ||
    mode === "starting" ||
    mode === "stopping"
  ) {
    showNotice(
      "Start playing or click Enable mouse playback at the bottom of the page.",
    );
    return;
  }
  const key = hitKey(keys, pointerPosition(e));
  if (key) {
    // Capture the pointer to receive later movement, release, and cancellation events reliably.
    canvas.setPointerCapture(e.pointerId);
    pointers.add(e.pointerId);
    noteOwners.set(`pointer:${e.pointerId}`, key.midi);
  }
});
function releasePointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  noteOwners.set(`pointer:${e.pointerId}`);
}
for (const event of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
] as const)
  canvas.addEventListener(event, releasePointer);
canvas.addEventListener("pointerleave", (e) => {
  pointerNote = undefined;
  releasePointer(e);
});
// Canvas keys are not focusable. Separate note buttons support Tab, Space, and Enter.
const accessibleKeys = document.querySelector(".accessible-keys")!;
[...keys]
  .sort((a, b) => a.midi - b.midi)
  .forEach((key) => {
    const button = document.createElement("button");
    button.textContent = key.note;
    button.dataset.midi = String(key.midi);
    button.setAttribute("aria-label", `Play ${key.note}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("keydown", (e) => {
      if ((e.key !== " " && e.key !== "Enter") || e.repeat) return;
      e.preventDefault();
      if (
        calibration !== undefined ||
        songPlayer.playing ||
        lessonLoading ||
        lesson.state === "paused"
      )
        return;
      if (
        !audio.ready ||
        mode === "paused" ||
        mode === "starting" ||
        mode === "stopping"
      ) {
        showNotice("Enable mouse playback or start playing first.");
        return;
      }
      keyboardHeld.add(String(key.midi));
      noteOwners.set(`keyboard:${key.midi}`, key.midi);
    });
    button.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") {
        keyboardHeld.delete(String(key.midi));
        noteOwners.set(`keyboard:${key.midi}`);
      }
    });
    button.addEventListener("blur", () => {
      keyboardHeld.delete(String(key.midi));
      noteOwners.set(`keyboard:${key.midi}`);
    });
    accessibleKeys.append(button);
  });
const dialog = $<HTMLDialogElement>("help-dialog");
$("help").addEventListener("click", () => {
  suspendLearning();
  if (mode === "running") pause();
  else clearNotes();
  dialog.showModal();
});
$("close-help").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    const p = e as MouseEvent;
    if (
      p.clientX < r.left ||
      p.clientX > r.right ||
      p.clientY < r.top ||
      p.clientY > r.bottom
    )
      dialog.close();
  }
});
// Clear input on blur or backgrounding so abandoned keys cannot remain held.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    suspendLearning();
    if (mode === "starting") void end();
    else if (mode === "running") pause();
    else clearNotes();
  }
});
window.addEventListener("blur", () => {
  suspendLearning();
  if (mode === "running") pause();
  else clearNotes();
});
window.addEventListener("pagehide", () => {
  suspendLearning();
  tracker.stop();
  clearNotes();
  void audio.close();
});

// Use CSS pixels for logic. DPR only scales the backing canvas via setTransform.
// This keeps high-density displays sharp without scaling fingertip or key coordinates twice.
function resize() {
  const r = $("stage").getBoundingClientRect();
  width = r.width;
  height = r.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resetInteraction();
}
new ResizeObserver(resize).observe($("stage"));
let lastDpr = devicePixelRatio;
// Each pair is a visual skeleton segment; it does not affect hit testing.
const connections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
/** Draw from the same rectangles used for hit testing. active and candidate are separate states. */
function drawKey(key: PianoKey, active: boolean, candidate: boolean) {
  ctx.beginPath();
  ctx.rect(key.x, key.y, key.w, key.h);
  ctx.fillStyle = active ? "#c7f6aa" : key.black ? "#16251e" : "#eef0df";
  ctx.globalAlpha = mode === "running" ? 0.82 : 0.97;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = active ? "#dcffc6" : key.black ? "#566757" : "#bec6b3";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (candidate || pointerNote === key.midi) {
    ctx.fillStyle = "rgba(171,224,144,.24)";
    ctx.fill();
    ctx.strokeStyle = "#bce79f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = active ? "#254126" : key.black ? "#bbc8b9" : "#65735e";
  ctx.textAlign = "center";
  ctx.font = `500 ${Math.max(9, Math.min(12, key.w * 0.2))}px system-ui`;
  ctx.fillText(
    key.note,
    key.x + key.w / 2,
    key.y + key.h - (key.black ? 12 : 18),
  );
  if (active) {
    ctx.fillStyle = "#517444";
    ctx.beginPath();
    ctx.arc(key.x + key.w / 2, key.y + key.h - 38, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Draw teaching outlines independently of held-key fills, below the black keys on white keys.
  const target =
    calibration !== undefined
      ? reachTargets[calibration]
      : songPlayer.playing
        ? songPlayer.current
        : lesson.target;
  if (
    (practicing || calibration !== undefined) &&
    (target === key.midi ||
      (lesson.wrong?.midi === key.midi &&
        lesson.wrong.until > performance.now()))
  ) {
    const isTarget = target === key.midi;
    ctx.strokeStyle = isTarget ? "#4da7ff" : "#eea04b";
    ctx.lineWidth = 3;
    const top = key.y + (key.black ? 3 : key.h * 0.64);
    ctx.strokeRect(key.x + 3, top, key.w - 6, key.y + key.h - top - 3);
    ctx.fillStyle = isTarget ? "#4da7ff" : "#eea04b";
    ctx.font = "bold 13px system-ui";
    ctx.fillText(isTarget ? "▼" : "!", key.x + key.w / 2, top + 17);
  }
}
/** The drawing loop refreshes every frame; capture limits inference requests independently. */
let lastFeedback = 0;
/** Show concise input feedback; detailed timing and counters appear only in expanded diagnostics. */
function updateInputFeedback(now: number) {
  if (now - lastFeedback < 150) return;
  lastFeedback = now;
  const states = [...hover.states.entries()].filter(
    ([, s]) => now - s.lastSeen < hover.graceMs,
  );
  const candidate = states.find(([, s]) => s.key && !s.active);
  const active = states.find(([, s]) => s.active);
  let text: string;
  if (mode === "starting" || lessonLoading || demoLoading)
    text = "Getting ready. Please wait for sound and tracking.";
  else if (
    mode === "paused" ||
    (lesson.state === "paused" && calibration === undefined)
  )
    text =
      mode === "stopped"
        ? "Practice paused; the camera is off. Resume to use the mouse, or start the camera for hand tracking."
        : "Paused. Click Resume to continue. Your camera stays connected until you end the session.";
  else if (songPlayer.playing)
    text =
      "Preview playing. Input is temporarily disabled. Stop the preview to practice.";
  else if (!audio.ready)
    text =
      "Piano sounds are not ready. Start playing or enable mouse playback.";
  else if (settings.volume === 0)
    text =
      "Volume is at zero. Keys still respond; turn up the volume to hear them.";
  else if (mode !== "running")
    text =
      "Mouse and keyboard are ready. Click Start playing to enable camera gestures.";
  else if (now - lastResult > 500)
    text =
      staleResults && lastFrameAge > 200
        ? "Tracking is delayed; old frames were skipped. Close busy apps and improve lighting."
        : "Waiting for a fresh frame. Keep your whole hand in view.";
  else if (!renderHands.length)
    text =
      "No hands detected. Keep your whole palm visible and avoid obstructions.";
  else if (candidate)
    text = `Confirming ${candidate[1].key!.note}: ${Math.round(hover.progress(candidate[0], now) * 100)}%. Keep your fingertip steady${hover.cadence > 100 ? "; tracking is slow, so hold a little longer" : ""}.`;
  else if (active)
    text = `${active[1].key!.note} played. The sound fades naturally. Move away and return to play again.`;
  else
    text =
      settings.fingers === "index"
        ? "Index fingers only. Move the center of the fingertip marker inside a key. Use the lower half of white keys."
        : "Move the center of a fingertip marker inside a key. Black keys take priority where keys overlap.";
  if ($("input-feedback").textContent !== text)
    $("input-feedback").textContent = text;
  if ($<HTMLDetailsElement>("diagnostics").open) {
    $("diagnostic-data").textContent = [
      `Tracking interval ~ ${hover.cadence.toFixed(0)} ms; gap tolerance ${hover.graceMs.toFixed(0)} ms`,
      `Last inference ${lastInference.toFixed(0)} ms; frame age ${lastFrameAge.toFixed(0)} ms; stale frames skipped ${staleResults} times`,
      `Gesture notes ${hover.diagnostics.triggers}; key changes/exits ${hover.diagnostics.changes}; timeout releases ${hover.diagnostics.losses}; gap resets ${hover.diagnostics.gaps} times`,
      `Latest reason: ${hover.diagnostics.last}`,
      ...states.map(
        ([id, state]) =>
          `${id} → ${state.key?.note ?? "Outside keys"}, ${state.active ? "Triggered" : `${Math.round(state.confirmedMs)} / ${hover.dwell} ms`}${state.interrupted ? " (tracking lost; progress frozen)" : ""}`,
      ),
    ].join("\n");
  }
}
function draw(now: number) {
  updateInputFeedback(now);
  if (lesson.wrong && now >= lesson.wrong.until) {
    lesson.wrong = undefined;
    renderLesson();
  }
  if (lastDpr !== devicePixelRatio) {
    lastDpr = devicePixelRatio;
    resize();
  }
  // Clear the transparent overlay. The video element plays the camera beneath it.
  ctx.clearRect(0, 0, width, height);
  if (mode === "running") {
    tracker.capture(now);
    // Expire lost fingertips even if the worker has not returned another result.
    hover.expire(now);
  }
  if (mode === "running" && lastResult && now - lastResult > 300) {
    renderHands = [];
    $("hand-count").textContent = "Looking for your hands";
    $("fps").textContent = "0";
  }
  const active = noteOwners.active;
  const candidates = new Set(
    [...hover.states.values()]
      .filter((s) => s.key && !s.active && now - s.lastSeen < hover.graceMs)
      .map((s) => s.key!.midi),
  );
  for (const key of keys)
    drawKey(key, active.has(key.midi), candidates.has(key.midi));
  if (mode === "running" && now - lastResult < 200)
    for (const hand of renderHands) {
      if (settings.skeleton) {
        ctx.strokeStyle = "rgba(207,248,184,.65)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const [a, b] of connections) {
          ctx.moveTo(hand.points[a].x, hand.points[a].y);
          ctx.lineTo(hand.points[b].x, hand.points[b].y);
        }
        ctx.stroke();
        for (const p of hand.points) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#d2edbd";
          ctx.fill();
        }
      }
      for (const tip of settings.fingers === "all" ? [4, 8, 12, 16, 20] : [8]) {
        const p = hand.points[tip];
        const id = `hand:${hand.id}:${tip}`;
        const state = hover.states.get(id);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = state?.active ? "#d3ffab" : "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          11,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * hover.progress(id, now),
        );
        ctx.strokeStyle = "#c7f6aa";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
  // Request the next browser drawing opportunity without blocking the page in a loop.
  requestAnimationFrame(draw);
}
// Load saved settings, initialize the interface, and start the drawing loop.
syncSettings();
syncSection();
renderLesson();
updateUI();
requestAnimationFrame(draw);
