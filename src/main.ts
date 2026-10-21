/**
 * 应用入口与总调度。推荐阅读顺序：
 * start准备资源 → draw请求新帧 → onResult处理指尖 → HoverEngine判断触发
 * → NoteOwners发送音符事件 → PianoAudio播放声音，draw同步更新画面。
 * 具体演奏规则见core.ts，摄像头通信见tracking.ts，声音实现见audio.ts。
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
// 先创建页面结构，后面再按id绑定按钮和设置事件；video和canvas在演奏区内叠放。
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<header class="header"><a class="brand" href="./" aria-label="Air Piano 首页"><span class="brand-icon">${icon}</span>AIR PIANO<span class="brand-divider"></span><span class="brand-cn">指尖之间</span></a><div class="header-right"><span class="local-label"><i></i> 画面仅在本机处理</span><button class="help-button" id="help">使用指南 <span>↗</span></button></div></header>
<main>
  <section class="intro"><div><div class="eyebrow"><span>INTERACTIVE SOUND EXPERIMENT</span><span class="edition">VOL. 01</span></div><h1>让空气，<span>有了旋律。</span></h1><p>伸出手，让指尖在琴键上短暂停留。每一次移动，都可以成为音乐。</p></div><div class="intro-mark" aria-hidden="true"><span>一双手。一个八度。</span><b>无限种旋律。</b><svg viewBox="0 0 100 36"><path d="M0 18h10l6-13 8 26L34 7l8 20 9-13 7 8h10l7-15 9 22 7-11h9"/></svg></div></section>
  <section class="learning" aria-label="曲库与逐音练习">
    <div class="learning-heading"><div><span class="eyebrow">PLAY · LEARN · REPEAT</span><h2>从一首旋律开始。</h2></div><div class="mode-switch" role="group" aria-label="演奏模式"><button id="free-mode" aria-pressed="true">自由弹奏</button><button id="practice-mode" aria-pressed="false">曲目练习</button></div></div>
    <div id="song-library" hidden><p class="learning-hint">选择一首入门曲，跟着蓝色箭头逐音弹奏。无需赶拍，弹对后再继续。</p>
      <div class="song-filters"><label>搜索曲目<input id="song-search" type="search" placeholder="输入曲名" /></label><label>难度<select id="song-level"><option value="all">全部难度</option><option value="入门">入门</option><option value="基础">基础</option></select></label><label>音域<select id="song-range"><option value="all">全部音域</option><option value="low">C4～G4以内</option><option value="high">包含C5</option></select></label></div>
      <div class="song-grid" id="song-grid"></div><p id="song-empty" hidden>没有符合条件的曲目，请调整筛选条件。</p><p class="song-source" id="song-source"></p></div>
    <details id="history-panel" hidden><summary id="history-summary">本地练习记录</summary><p class="learning-hint">仅保存在本浏览器，保留最近50次，列表显示最近10次，可随时清除。仅比较同一曲目、同一范围的成绩。</p><p id="history-stats"></p><ol id="history-list"></ol><button id="history-clear" class="secondary">清除记录</button></details>
  </section>
  <div class="workspace">
    <section class="instrument" aria-label="虚拟钢琴演奏区">
      <section id="lesson-panel" class="lesson-panel" aria-label="练习指引" hidden>
        <div class="lesson-top"><div><span id="lesson-title"></span><strong id="lesson-target">准备开始</strong></div><span id="lesson-progress">0 / 0</span></div>
        <progress id="lesson-bar" value="0" max="1" aria-label="练习进度"></progress>
        <div id="lesson-upcoming" class="upcoming" aria-label="后续音符"></div>
        <details id="practice-options"><summary id="practice-scope">练习范围与试听速度</summary><div class="practice-fields"><label>起始音符<input id="section-start" type="number" min="1" value="1" /></label><label>结束音符<input id="section-end" type="number" min="1" value="42" /></label><button id="section-apply">应用范围</button><button id="section-full">恢复整首</button><label>试听速度<select id="listen-speed"><option value="0.5">0.5倍</option><option value="0.75">0.75倍</option><option value="1" selected>1倍</option><option value="1.25">1.25倍</option></select></label><label class="loop-control"><input id="section-loop" type="checkbox" />循环练习（完成并释放后重来）</label></div><p class="field-hint">范围按非休止音符编号；改变范围会重新开始，试听使用同一范围。</p></details>
        <p id="lesson-feedback" role="status" aria-live="polite"></p>
        <div class="lesson-actions"><button class="primary" id="lesson-start">开始练习</button><button class="secondary" id="lesson-pause" disabled>暂停练习</button><button class="secondary" id="song-listen">试听整首</button><button class="secondary" id="lesson-library">返回曲库</button></div>
        <div id="lesson-result" class="lesson-result" hidden></div>
        <button id="lesson-retry" class="secondary" hidden>练习易错片段</button>
        <p class="lesson-rule">蓝色边框＋▼为目标，绿色为实际发声。每音后移开手指；休止与长短只在试听中体现，练习不评价节奏。</p>
      </section>
      <div class="stage" id="stage">
        <video id="video" autoplay muted playsinline aria-hidden="true"></video>
        <canvas id="canvas" aria-label="虚拟琴键，启用鼠标试听后可点击演奏"></canvas>
        <div class="stage-top"><span class="stage-label"><i id="live-dot"></i><span id="stage-state">演奏空间</span></span><span class="octave-label">C4 — C5 <span>／</span> 13 KEYS</span></div>
        <div class="stage-message" id="stage-message"><div class="camera-symbol"><svg viewBox="0 0 48 48" fill="none"><rect x="8" y="12" width="32" height="26" rx="8" stroke="currentColor" stroke-width="1.5"/><circle cx="24" cy="25" r="7" stroke="currentColor" stroke-width="1.5"/><path d="m17 12 3-5h8l3 5" stroke="currentColor" stroke-width="1.5"/></svg></div><h2 id="message-title">下一首，交给你的双手。</h2><p id="message-description">开启摄像头，进入你的空气演奏空间。</p></div>
        <div class="stage-bottom"><span><i></i> 镜像画面 · 悬停触发</span><span id="hand-count">等待双手入镜</span></div>
      </div>
      <div class="transport"><div class="transport-buttons"><button class="primary" id="start"><span>◉</span> 开始演奏</button><button class="secondary" id="pause" disabled>Ⅱ 暂停</button><button class="icon-button" id="stop" disabled aria-label="结束演奏">■</button></div><div class="current-note"><span>正在发声</span><strong id="notes" aria-live="polite">—</strong></div></div>
      <div class="instrument-caption"><span class="tiny-dot"></span><span id="caption">无需接触屏幕，让画面中的指尖进入琴键区域即可。</span></div>
      <div id="input-feedback" class="input-feedback" role="status" aria-live="polite">开启摄像头，或使用鼠标试听。</div>
      <div class="reach-check"><button id="reach-start" class="secondary">检查琴键可达性</button><span id="reach-status">开启摄像头后，依次用指尖确认左、中、右三个琴键。</span></div>
      <details id="diagnostics"><summary>触发诊断（可选）</summary><pre id="diagnostic-data"></pre><p class="field-hint">只显示本次运行的计数与触发原因，不记录画面、不上传。</p></details>
      <div id="notice" class="notice" role="status" hidden></div>
      <div class="accessible-keys" aria-label="键盘演奏，聚焦音符后按空格或回车"></div>
    </section>
    <aside class="panel" aria-label="演奏设置">
      <div class="panel-heading"><span>演奏设置</span><span class="panel-tag">YOUR SESSION</span></div>
      <div class="statuses" aria-label="系统状态"><div><i id="camera-dot"></i><span>摄像头</span><b id="camera-status">未开启</b></div><div><i id="model-dot"></i><span>手部追踪</span><b id="model-status">未加载</b></div><div><i id="audio-dot"></i><span>钢琴音色</span><b id="audio-status">未加载</b></div></div>
      <div class="setting-block"><div class="field-title"><label for="volume">演奏音量</label><output id="volume-value"></output></div><input id="volume" type="range" min="0" max="100" step="1" aria-label="演奏音量"/><div class="range-ends"><span>安静一点</span><span>尽情演奏</span></div></div>
      <div class="setting-block"><div class="field-title"><label for="dwell">悬停时间</label><output id="dwell-value"></output></div><input id="dwell" type="range" min="50" max="300" step="10" aria-label="悬停时间"/><p class="field-hint">停留后发声，时间越长越不易误触。</p></div>
      <div class="setting-block"><div class="field-title"><span>参与演奏的手指</span></div><div class="segmented" role="group" aria-label="参与演奏的手指"><button id="index-fingers">双食指 <small>推荐入门</small></button><button id="all-fingers">全部手指 <small>多指和弦</small></button></div><label class="switch-row" for="skeleton"><span>显示手部骨架</span><input id="skeleton" type="checkbox" role="switch"/></label></div>
      <details class="layout-settings"><summary>琴键布局 <span>位置与大小</span></summary><div class="layout-fields">${[
        ["width", "琴键宽度", 50, 96],
        ["height", "琴键高度", 18, 45],
        ["x", "水平位置", 0, 100],
        ["y", "垂直位置", 0, 100],
      ]
        .map(
          ([id, label, min, max]) =>
            `<div><div class="field-title"><label for="layout-${id}">${label}</label><output id="layout-${id}-value"></output></div><input id="layout-${id}" type="range" min="${min}" max="${max}" step="1"/></div>`,
        )
        .join("")}</div></details>
      <button class="reset-button" id="reset">↺ 恢复默认设置</button>
      <div class="performance"><span><i></i> <span id="fps">—</span> FPS</span><span>推理 <b id="inference">—</b> ms</span></div>
    </aside>
  </div>
  <section class="guide" aria-label="快速入门"><div class="guide-heading"><span class="eyebrow">A LITTLE GUIDANCE</span><h2>三步，开始你的即兴。</h2></div><div class="guide-step"><b>01</b><div><h3>开启你的空间</h3><p>允许摄像头访问，让双手清晰入镜。</p></div></div><div class="guide-step"><b>02</b><div><h3>找到你的琴键</h3><p>看着镜像画面，将指尖移到琴键内。</p></div></div><div class="guide-step"><b>03</b><div><h3>停留，然后奏响</h3><p>短暂停留发音，移开后即可再次弹奏。</p></div></div></section>
</main>
<footer><span>AIR PIANO <span class="footer-dot">·</span> 指尖之间</span><span>没有摄像头？<button id="demo">开启鼠标试听 ↗</button></span><span>用双手，感受音乐。</span></footer>
<dialog id="help-dialog"><div class="dialog-header"><span class="eyebrow">GET STARTED</span><button id="close-help" aria-label="关闭指南">×</button></div><h2>让指尖与琴键相遇。</h2><ol><li>在光线均匀的环境下，固定电脑摄像头，让手掌与指尖完整入镜。</li><li>点击“开始演奏”，允许摄像头访问，等待追踪和音色准备完成。</li><li>看着镜像画面移动食指，让指尖标记进入琴键，停留后发音。此时手指在空中移动，无需碰屏幕。</li><li>移开再进入可重复弹奏。“全部手指”支持和弦；布局可调整琴键的大小和位置。</li></ol><p>手指交叠、快速移动或弱光可能影响追踪。先使用双食指熟悉操作。切换后台会自动暂停。</p><div class="dialog-credit">钢琴音色：Salamander Grand Piano · Alexander Holm<br><a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a> · 采样经 Tone.js Audio 分发，按音高变调。<br>视频仅在本机处理，不上传也不录制。</div></dialog>`;

// 按id获取页面元素的简写。泛型T只帮助TypeScript识别元素类型，不生成额外界面。
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
// 会话状态决定按钮可用性和是否提交新帧；暂停保留摄像头，结束则释放资源。
let mode: "stopped" | "starting" | "running" | "paused" | "stopping" =
  "stopped";
// 每次启动/结束递增，用来丢弃旧会话的异步结果，防止结束后又被“迟到的成功”恢复。
let token = 0;
let width = 1000,
  height = 750;
/** 把琴键限制在视频实际显示区域内，避免画到指尖无法到达的留白中。 */
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
  /* 存储不可用时仍能练习。 */
}
let staleResults = 0,
  lastInference = 0,
  lastFrameAge = 0;
let calibration: number | undefined;
const reachTargets = [60, 67, 72];
const songPlayer = new SongPlayer(audio, renderLesson);
// 音符占用模块只发on/off事件；这里统一连接声音、当前音名和辅助按钮状态。
const noteOwners = new NoteOwners((event) => {
  if (event.type === "on") audio.on(event.midi);
  else audio.off(event.midi);
  // 这里只经过摄像头、鼠标或辅助键盘的用户事件；自动试听直接交给SongPlayer。
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
        "检查完成：左、中、右琴键都可以触达。布局已沿用当前设置。";
      $("reach-start").textContent = "重新检查可达性";
    } else
      $("reach-status").textContent =
        `请移开，再用指尖确认 ${noteName(reachTargets[calibration])}；够不到时可调整“琴键布局”。`;
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
// 三个模块协作：关联同一只手 → 判断手指悬停 → 由noteOwners管理发音占用。
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
/** 清理本次交互：释放所有来源的音符，丢弃旧手部、鼠标与键盘状态。 */
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
/** 仅将当前状态反映到界面，不在此启动摄像头、模型或声音。 */
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
    mode === "paused" || lesson.state === "paused" ? "▷ 继续" : "Ⅱ 暂停";
  $("stop").toggleAttribute(
    "disabled",
    (mode === "stopped" && !audio.ready && !lessonLoading) ||
      mode === "stopping",
  );
  $("start").innerHTML =
    mode === "starting"
      ? '<span class="spinner"></span> 正在准备'
      : "<span>◉</span> 开始演奏";
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
    stopped: "演奏空间",
    starting: "正在准备",
    running: "LIVE · 正在演奏",
    paused: "已暂停",
    stopping: "正在结束",
  }[mode];
  if (mode === "starting") {
    $("message-title").textContent = "你的演奏空间，正在准备。";
    $("message-description").textContent =
      "请允许摄像头访问，首次加载可能需要一些时间。";
  }
  if (mode === "paused") {
    $("message-title").textContent = "留一点空白，给下一段旋律。";
    $("message-description").textContent =
      "声音与识别已暂停，摄像头仍保持开启；继续时复用当前连接。";
  }
  if (mode === "stopped") {
    $("message-title").textContent = audio.ready
      ? "鼠标也能奏响旋律。"
      : "下一首，交给你的双手。";
    $("message-description").textContent = audio.ready
      ? "点击琴键试听；开启摄像头，体验双手演奏。"
      : "开启摄像头，进入你的空气演奏空间。";
  }
}
/** 一次启动必须等摄像头、模型、音频全部准备好；任何一步失败都进入清理。 */
async function start() {
  if (mode !== "stopped" || demoLoading || lessonLoading) return;
  suspendLearning();
  const current = ++token;
  demoToken++;
  mode = "starting";
  clearNotes();
  showNotice("");
  updateUI();
  status("camera", "等待授权", "loading");
  status("model", "加载中", "loading");
  status("audio", "准备中", "loading");
  try {
    // 并行准备三种资源；各自的then只更新状态，全部成功后才切换到running。
    await Promise.all([
      tracker.openCamera().then(() => {
        if (current === token) status("camera", "已开启", "ready");
      }),
      tracker.initModel().then(() => {
        if (current === token) status("model", "已就绪", "ready");
      }),
      audio
        .prepare((n) => {
          if (current === token) status("audio", `采样 ${n}/5`, "loading");
        })
        .then(() => {
          if (current === token) status("audio", "已就绪", "ready");
        }),
    ]);
    if (current !== token) return;
    if (!audio.ready) throw new Error("浏览器暂停了音频，请重试。");
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
      "让指尖标记进入琴键，停留后发音；移开后可再次弹奏。";
  } catch (e) {
    if (current !== token) return;
    await end();
    showNotice(cameraError(e), true);
  }
}
/** 先使旧任务失效，再释放声音、识别线程和视频流，最后恢复初始界面。 */
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
  status("camera", "未开启");
  status("model", "未加载");
  status("audio", "未加载");
  $("fps").textContent = "—";
  $("inference").textContent = "—";
  $("hand-count").textContent = "等待双手入镜";
  $("demo").textContent = "开启鼠标试听 ↗";
  $("caption").textContent = "无需接触屏幕，让画面中的指尖进入琴键区域即可。";
  updateUI();
}
async function failSession(error: Error) {
  if (mode === "stopped" || mode === "stopping") return;
  await end();
  status("model", "已停止", "error");
  showNotice(error.message, true);
}
// 暂停只清理交互，不关闭摄像头；draw在paused状态下不会继续提交新帧。
function pause() {
  if (mode !== "running") return;
  suspendLearning();
  mode = "paused";
  clearNotes();
  $("hand-count").textContent = "演奏已暂停";
  status("camera", "保持连接", "ready");
  status("model", "已暂停");
  updateUI();
}
// 继续时重新启用可能暂停的音频，并清空旧手指状态，让用户重新悬停确认。
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
    status("camera", "已开启", "ready");
    status("model", "已就绪", "ready");
    updateUI();
  } catch (e) {
    showNotice(cameraError(e), true);
  }
}
/** 识别结果进入演奏逻辑的入口：手部关联 → 坐标映射 → 选指尖 → 悬停判断。 */
function onResult(result: TrackingResult) {
  // 停止/暂停期间忽略结果；超过200毫秒的旧画面也不能拿来触发当前琴键。
  if (mode !== "running") return;
  lastInference = result.ms;
  lastFrameAge = performance.now() - result.timestamp;
  if (lastFrameAge > 200) {
    staleResults++;
    return;
  }
  lastResult = performance.now();
  // 统计最近1秒接受的识别结果数；这里的FPS不是屏幕或Canvas的刷新率。
  frameTimes.push(lastResult);
  frameTimes = frameTimes.filter((t) => lastResult - t < 1000);
  $("fps").textContent = String(frameTimes.length);
  $("inference").textContent = result.ms.toFixed(0);
  $("hand-count").textContent = result.hands.length
    ? `${result.hands.length} 只手已入镜`
    : "请将双手放入画面";
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
  // MediaPipe指尖编号：拇指4、食指8、中指12、无名指16、小指20。
  const tips = settings.fingers === "all" ? [4, 8, 12, 16, 20] : [8];
  // 组合手部编号和关键点编号，使每根手指独立计时；flatMap将双手指尖合成一张列表。
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
/** 设置仅保存在当前浏览器本地；JSON.stringify把设置对象转换成可保存的文本。 */
function persist() {
  try {
    localStorage.setItem("air-piano:v1", JSON.stringify(settings));
  } catch {
    showNotice("浏览器未允许保存设置。本次会话仍可使用。");
  }
}
function currentPracticeSong() {
  return songSection(selectedSong, sectionStart, sectionEnd);
}

/** 完成记录只写入一次，暂停、重画和最后一次off都不能重复累计。 */
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
    showNotice("无法保存练习记录，本次结果仍可查看。");
  }
  renderHistory();
}
function renderHistory() {
  $("history-summary").textContent = `本地练习记录（${history.length}次）`;
  const matching = history.filter(
    (row) =>
      row.songId === selectedSong.id &&
      row.start === sectionStart &&
      row.end === sectionEnd,
  );
  const accuracy = (row: PracticeRecord) =>
    Math.round((row.firstTry / (row.end - row.start)) * 100);
  $("history-stats").textContent = matching.length
    ? `${selectedSong.title} · 当前范围已练习 ${matching.length} 次，最近 ${accuracy(matching[0])}%，最佳 ${Math.max(...matching.map(accuracy))}%。`
    : "当前曲目和范围尚无完成记录。";
  $("history-list").replaceChildren(
    ...history.slice(0, 10).map((row) => {
      const item = document.createElement("li");
      item.textContent = `${new Date(row.at).toLocaleString("zh-CN")} · ${SONGS.find((song) => song.id === row.songId)!.title} 第${row.start + 1}～${row.end}音 · 首次命中 ${accuracy(row)}% · 错误 ${row.mistakes} 次 · ${(row.elapsedMs / 1000).toFixed(1)}秒`;
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
/** 曲库界面只显示控制器的状态，不通过颜色或DOM内容反推练习进度。 */
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
    `第${sectionStart + 1}～${sectionEnd}音 / 共${practiceNotes(selectedSong).length}音 · 范围与试听速度`;
  $("song-source").textContent =
    `${selectedSong.source} · ${selectedSong.bpm} BPM（试听速度）`;
  $("lesson-target").textContent = songPlayer.playing
    ? `试听中 · ${songPlayer.current === undefined ? "准备 / 休止" : noteName(songPlayer.current)}`
    : lesson.state === "completed"
      ? "练习完成！"
      : lesson.target === undefined
        ? "准备开始"
        : `▼ 请弹 ${noteName(lesson.target)}`;
  $("lesson-progress").textContent = `${lesson.index} / ${notes.length}`;
  const bar = $<HTMLProgressElement>("lesson-bar");
  bar.max = notes.length || 1;
  bar.value = lesson.index;
  $("lesson-upcoming").textContent = `接下来：${
    notes
      .slice(started ? lesson.index + 1 : 0, started ? lesson.index + 6 : 5)
      .map(noteName)
      .join(" → ") || "—"
  }`;
  $("lesson-feedback").textContent =
    error ||
    (lessonLoading
      ? "正在准备音色…"
      : songPlayer.playing
        ? "先听一遍旋律。试听不计入练习，可随时停止。"
        : lesson.state === "release"
          ? "弹对了！请先释放所有琴键，再弹下一个音。"
          : lesson.state === "paused"
            ? "练习已暂停，进度已保留。继续后请重新触发目标琴键。"
            : lesson.state === "completed"
              ? "这首曲目已完成，可以重新练习或选择其他歌曲。"
              : lesson.wrong && lesson.wrong.until > performance.now()
                ? `再试一次，请弹 ${noteName(lesson.target!)}。`
                : lesson.state === "playing"
                  ? "跟随蓝色箭头，弹对后继续。"
                  : "可使用摄像头，也可直接开始后用鼠标或辅助音符按钮练习。");
  $("lesson-start").textContent = started ? "重新开始" : "开始练习";
  const busy =
    lessonLoading || demoLoading || mode === "starting" || mode === "stopping";
  $("lesson-start").toggleAttribute("disabled", busy || !!error);
  $("song-listen").toggleAttribute("disabled", busy || !!error);
  $("song-listen").textContent = songPlayer.playing ? "停止试听" : "试听整首";
  $("lesson-pause").textContent =
    lesson.state === "paused" ? "继续练习" : "暂停练习";
  $("lesson-pause").toggleAttribute(
    "disabled",
    busy || (!lesson.active && lesson.state !== "paused"),
  );
  $("lesson-result").hidden = lesson.state !== "completed";
  $("lesson-retry").hidden =
    lesson.state !== "completed" || !lesson.mistakeSteps.size;
  if (lesson.state === "completed") {
    $("lesson-result").textContent =
      `完成 ${lesson.index} 个音符 · 错误输入 ${lesson.mistakes} 次 · 首次命中率 ${lesson.accuracy}% · 有效用时 ${(lesson.elapsedMs / 1000).toFixed(1)} 秒（不评价节奏）`;
  }
  $("stage-message").hidden =
    mode === "running" || (practicing && (started || songPlayer.playing));
}

/** 使旧异步操作失效，并在释放音符之前暂停判定，避免清理事件改变当前步骤。 */
function suspendLearning() {
  allowLoop = false;
  if (calibration !== undefined) {
    calibration = undefined;
    $("reach-status").textContent = "可达性检查已暂停，可重新开始。";
    $("reach-start").textContent = "检查琴键可达性";
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

/** 由按钮点击启用音频；代号检查防止切歌/结束后旧加载结果启动上一首曲子。 */
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
  status("audio", "准备中", "loading");
  renderLesson();
  updateUI();
  try {
    await audio.prepare();
    if (generation !== lessonGeneration || document.hidden) return;
    if (!audio.ready) throw new Error("浏览器暂停了音频，请重新点击。");
    // 恢复摄像头会话后再恢复课程，二者共享同一次音频授权。
    if (mode === "paused") {
      mode = "running";
      frameTimes = [];
      lastResult = 0;
      status("camera", "已开启", "ready");
      status("model", "已就绪", "ready");
    }
    status("audio", "已就绪", "ready");
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
    status("audio", "加载失败", "error");
    showNotice(cameraError(e), true);
  } finally {
    if (generation === lessonGeneration) {
      lessonLoading = false;
      renderLesson();
      updateUI();
    } else if (!lessonLoading && !demoLoading && mode === "stopped") {
      // 切歌会取消“启动意图”，但可以复用已下载的采样；不要遗留“准备中”状态。
      status(
        "audio",
        audio.ready ? "已就绪" : "未加载",
        audio.ready ? "ready" : "idle",
      );
      updateUI();
    }
  }
}

$("song-grid").innerHTML = SONGS.map((song) => {
  const pitches = practiceNotes(song);
  return `<button class="song-card" data-song="${song.id}" aria-pressed="false"><span>${song.difficulty}</span><strong>${song.title}</strong><small>${song.description}</small><em>${pitches.length} 个音 · ${noteName(Math.min(...pitches))}～${noteName(Math.max(...pitches))}</em></button>`;
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
      "范围无效：起始和结束须为曲目内的整数编号，且起始不大于结束。",
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
    showNotice("试听速度已更改，点击试听从当前范围开头播放。");
  }
});
$("history-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
    history = [];
    renderHistory();
  } catch {
    showNotice("浏览器未允许清除记录，请检查网站存储设置。", true);
  }
});
$("reach-start").addEventListener("click", () => {
  if (calibration !== undefined) {
    suspendLearning();
    return;
  }
  if (mode !== "running") {
    showNotice("请先开启或继续摄像头演奏，再检查指尖是否能到达琴键。");
    return;
  }
  suspendLearning();
  calibration = 0;
  $("reach-start").textContent = "停止可达性检查";
  $("reach-status").textContent =
    "请用指尖确认 C4，再检查 G4、C5；够不到时可调整“琴键布局”。";
});
function togglePause() {
  // 课程可能在布局检查时单独暂停；优先恢复课程，避免第一次“继续”反而暂停摄像头。
  if (lesson.state === "paused" && practicing) void prepareLearning("resume");
  else if (mode === "running") pause();
  else if (mode === "paused") void resume();
  else if (lesson.state === "paused") void prepareLearning("resume");
  else if (lesson.active) suspendLearning();
}

/** 将内存里的settings写回滑块、文字和开关，供首次加载或恢复默认时复用。 */
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
// 布局、悬停时间或手指模式变化后，不能沿用之前琴键上的占用与计时。
function resetInteraction() {
  clearNotes();
  keys = keyboardGeometry();
  hover.dwell = settings.dwell;
}
// 控件事件：先更新实际设置/交互，再同步界面并保存。音量变化无需重新计算琴键。
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
  showNotice("已恢复默认设置。");
});
// 鼠标试听只准备音频，允许没有摄像头的用户验证音色和琴键操作。
$("demo").addEventListener("click", async () => {
  if (lesson.state === "paused") {
    showNotice("请先继续练习，或切换到自由弹奏。");
    return;
  }
  if (mode === "paused") {
    showNotice("请先继续或结束演奏，再进行鼠标试听。");
    return;
  }
  if (mode === "starting" || mode === "stopping" || demoLoading) return;
  if (audio.ready) {
    showNotice("音色已就绪，点击琴键即可试听。");
    return;
  }
  const current = ++demoToken;
  demoLoading = true;
  $("start").setAttribute("disabled", "");
  $("demo").setAttribute("disabled", "");
  status("audio", "准备中", "loading");
  try {
    await audio.prepare((n) => {
      if (current === demoToken) status("audio", `采样 ${n}/5`, "loading");
    });
    if (current !== demoToken) return;
    status("audio", "已就绪", "ready");
    $("demo").textContent = "鼠标试听已就绪 ♪";
    showNotice(
      "音色已就绪。按住琴键试听，松开后释放；也可用 Tab 选择音符，按空格或回车演奏。",
    );
    $("stop").removeAttribute("disabled");
  } catch (e) {
    if (current === demoToken) {
      status("audio", "加载失败", "error");
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
/** 将浏览器窗口中的鼠标坐标转成Canvas内部的逻辑坐标，补偿位置与显示缩放。 */
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
// 鼠标/触控按下直接占用音符，不走摄像头的悬停计时；松开、取消或移出时释放。
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
    showNotice("请先开始演奏，或点击页面底部“开启鼠标试听”。");
    return;
  }
  const key = hitKey(keys, pointerPosition(e));
  if (key) {
    // 捕获这次指针操作，便于在拖动、抬起或取消时接收到后续事件并清理。
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
// Canvas图形不自带可聚焦琴键，另建音符按钮，支持Tab选择和空格/回车演奏。
const accessibleKeys = document.querySelector(".accessible-keys")!;
[...keys]
  .sort((a, b) => a.midi - b.midi)
  .forEach((key) => {
    const button = document.createElement("button");
    button.textContent = key.note;
    button.dataset.midi = String(key.midi);
    button.setAttribute("aria-label", `演奏 ${key.note}`);
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
        showNotice("请先开启鼠标试听或开始演奏。");
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
// 后台和失焦时清理交互，避免用户离开页面后仍保留按键或悬停状态。
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

// 逻辑坐标统一使用CSS像素；高DPR只增加画布背板像素，再通过setTransform保持坐标一致。
// 这样高分屏更清晰，同时无需把指尖坐标和琴键位置再乘一次DPR。
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
// 每一对编号是一段手部骨骼，只负责可视化，不参与琴键命中。
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
/** 使用与命中检测相同的矩形绘制琴键；active表示已触发，candidate表示悬停确认中。 */
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
  // 教学目标独立于按下填充色；白键提示画在下半部，避免被后绘制的黑键遮挡。
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
/** 浏览器的绘画循环；每次刷新都绘图，但capture会自行限制推理提交频率。 */
let lastFeedback = 0;
/** 用户只看简明原因；展开诊断后才能看到具体时间和计数。 */
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
    text = "正在准备，请等待音色与追踪就绪。";
  else if (
    mode === "paused" ||
    (lesson.state === "paused" && calibration === undefined)
  )
    text =
      mode === "stopped"
        ? "练习已暂停，摄像头未开启。继续后可用鼠标；手势演奏请先开启摄像头。"
        : "已暂停：点击任一“继续”按钮恢复。摄像头连接会保留；结束演奏才会释放。";
  else if (songPlayer.playing)
    text = "正在试听：用户输入暂时关闭，停止试听后可开始练习。";
  else if (!audio.ready) text = "音色尚未就绪：请开始演奏，或开启鼠标试听。";
  else if (settings.volume === 0)
    text = "当前音量为0，琴键仍可触发；请调高演奏音量后试听。";
  else if (mode !== "running")
    text = "鼠标/辅助键盘已就绪；使用手势还需要点击“开始演奏”开启摄像头。";
  else if (now - lastResult > 500)
    text =
      staleResults && lastFrameAge > 200
        ? "识别结果延迟较大，已跳过旧画面。请减少其他程序负载并保持光线充足。"
        : "等待最新手部画面，请将完整手掌放入镜头。";
  else if (!renderHands.length)
    text = "没有识别到手：请让手掌完整入镜，减少遮挡。";
  else if (candidate)
    text = `正在确认 ${candidate[1].key!.note}：${Math.round(hover.progress(candidate[0], now) * 100)}%。请保持指尖稳定${hover.cadence > 100 ? "，当前识别较慢，可能需要多停留片刻" : ""}。`;
  else if (active)
    text = `${active[1].key!.note} 已触发；声音会自然衰减，移开后重新进入才能再响。`;
  else
    text =
      settings.fingers === "index"
        ? "仅双食指参与：请将食指圆点中心移到琴键内，白键可使用下半部。"
        : "请将指尖圆点中心移到琴键内，黑键覆盖区域优先算黑键。";
  if ($("input-feedback").textContent !== text)
    $("input-feedback").textContent = text;
  if ($<HTMLDetailsElement>("diagnostics").open) {
    $("diagnostic-data").textContent = [
      `有效识别间隔约 ${hover.cadence.toFixed(0)} ms；短暂漏检容忍 ${hover.graceMs.toFixed(0)} ms`,
      `最近推理 ${lastInference.toFixed(0)} ms；帧龄 ${lastFrameAge.toFixed(0)} ms；跳过旧结果 ${staleResults} 次`,
      `手势起音 ${hover.diagnostics.triggers} 次；切键/离开 ${hover.diagnostics.changes} 次；超时释放 ${hover.diagnostics.losses} 次；间隔重置 ${hover.diagnostics.gaps} 次`,
      `最近原因：${hover.diagnostics.last}`,
      ...states.map(
        ([id, state]) =>
          `${id} → ${state.key?.note ?? "区域外"}，${state.active ? "已触发" : `${Math.round(state.confirmedMs)} / ${hover.dwell} ms`}${state.interrupted ? "（漏检，进度冻结）" : ""}`,
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
  // 清空的是透明覆盖层；摄像头视频由下面的video元素自行播放，无需在这里重画。
  ctx.clearRect(0, 0, width, height);
  if (mode === "running") {
    tracker.capture(now);
    // 即使Worker迟迟不回结果，也按时间释放已经丢失的手指。
    hover.expire(now);
  }
  if (mode === "running" && lastResult && now - lastResult > 300) {
    renderHands = [];
    $("hand-count").textContent = "正在重新寻找双手";
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
  // 请求浏览器在下一次绘画时机再次调用本函数，而不是用无限循环阻塞网页。
  requestAnimationFrame(draw);
}
// 首次加载：显示已保存设置、更新初始状态，然后启动绘画循环。
syncSettings();
syncSection();
renderLesson();
updateUI();
requestAnimationFrame(draw);
