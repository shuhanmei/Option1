/**
 * 演奏规则模块，不直接访问摄像头、网页或扬声器，方便独立测试。
 * 数据流：手部关联与平滑 → 坐标换算 → 琴键命中 → 悬停确认 → 音符占用事件。
 */

/** 二维点。模型输出使用0～1的相对坐标，映射到画布后使用CSS像素。 */
export interface Point {
  x: number;
  y: number;
}
/** 矩形：x、y是左上角，w、h是宽高；绘制与命中检测共用这些数据。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PianoKey extends Rect {
  note: string; // 显示用的音名，如C4。
  midi: number; // 表示音高的数字编号，C4为60，相邻半音相差1。
  black: boolean; // 黑键需要覆盖白键，并优先参与命中判断。
}
/** 布局数值均为百分比；x、y表示在“放下琴键后剩余的空间”中的位置。 */
export interface Layout {
  width: number;
  height: number;
  x: number;
  y: number;
}
export const DEFAULT_LAYOUT: Layout = { width: 84, height: 30, x: 50, y: 64 };
// C、D、E、F、G、A、B相对C的半音偏移，所以白键音高不是连续加1。
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const NAMES = [
  "C4",
  "C♯4",
  "D4",
  "D♯4",
  "E4",
  "F4",
  "F♯4",
  "G4",
  "G♯4",
  "A4",
  "A♯4",
  "B4",
  "C5",
];
/** C4～C5：8个白键、5个黑键；结果先白后黑。 */
export function makeKeys(
  width: number,
  height: number,
  layout: Layout,
): PianoKey[] {
  const w = (width * layout.width) / 100;
  const h = (height * layout.height) / 100;
  // 例如区域宽1000、琴键宽840，x=50时，左侧留白为(1000-840)×50%=80。
  const x = ((width - w) * layout.x) / 100;
  const y = ((height - h) * layout.y) / 100;
  const step = w / WHITE.length;
  // 每个白键两侧各留1像素形成间隔；m决定音高，i决定横向位置。
  const white = WHITE.map((m, i) => ({
    x: x + i * step + 1,
    y,
    w: step - 2,
    h,
    note: NAMES[m],
    midi: 60 + m,
    black: false,
  }));
  const black = [1, 3, 6, 8, 10].map((m) => {
    // 黑键放在相邻白键的分界线上；0.29是黑键宽度0.58的一半。
    const boundary = WHITE.filter((n) => n < m).length;
    return {
      x: x + boundary * step - step * 0.29,
      y,
      w: step * 0.58,
      h: h * 0.61,
      note: NAMES[m],
      midi: 60 + m,
      black: true,
    };
  });
  return [...white, ...black];
}
/** margin为正会扩大矩形，为负会收缩；用来提供进出琴键时的边界容差。 */
export function contains(r: Rect, p: Point, margin = 0): boolean {
  return (
    p.x >= r.x - margin &&
    p.x <= r.x + r.w + margin &&
    p.y >= r.y - margin &&
    p.y <= r.y + r.h + margin
  );
}
export function hitKey(
  keys: PianoKey[],
  p: Point,
  inset = 0,
): PianoKey | undefined {
  // 黑键在数组后面，反向查找可优先命中黑键；先复制，避免修改绘制顺序。
  return [...keys].reverse().find((key) => contains(key, p, -inset));
}
/**
 * 把模型相对坐标换成画布坐标，与视频的object-fit: contain保持一致。
 * 先等比例缩放，再加居中留白；镜像显示时只在这里反转一次横坐标。
 * sourceWidth/Height是原视频大小，width/height是画布的CSS显示大小。
 */
export function mapPoint(
  p: Point,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mirror = true,
): Point {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return {
    x:
      (width - sourceWidth * scale) / 2 +
      (mirror ? 1 - p.x : p.x) * sourceWidth * scale,
    y: (height - sourceHeight * scale) / 2 + p.y * sourceHeight * scale,
  };
}
export type NoteEvent = { type: "on" | "off"; midi: number };
/**
 * 统一管理“谁占用了哪个音符”。Map保存：手指/鼠标/键盘编号 → MIDI音高。
 * 同音首次被占用时发送on，最后一个占用者离开时才发送off，避免多指互相打断。
 * emit是调用方传入的回调，由main.ts把事件转交给音频模块。
 */
export class NoteOwners {
  private owners = new Map<string, number>();
  constructor(private emit: (event: NoteEvent) => void) {}
  /** 传入midi表示按下或切换音符；省略midi表示该输入释放当前音符。 */
  set(owner: string, midi?: number) {
    if (this.owners.get(owner) === midi) return;
    // 先解除旧占用，再建立新占用；相同输入仍停在同音时已在上面直接返回。
    const old = this.owners.get(owner);
    this.owners.delete(owner);
    if (old !== undefined && ![...this.owners.values()].includes(old))
      this.emit({ type: "off", midi: old });
    // 已经有其他输入占用该音符时，只记录新占用，不重复起音。
    if (midi !== undefined) {
      const occupied = [...this.owners.values()].includes(midi);
      this.owners.set(owner, midi);
      if (!occupied) this.emit({ type: "on", midi });
    }
  }
  /** 只释放指定来源，例如hand:前缀代表手指，不影响鼠标或键盘的占用。 */
  releasePrefix(prefix: string) {
    for (const id of [...this.owners.keys()])
      if (id.startsWith(prefix)) this.set(id);
  }
  reset() {
    const active = this.active;
    // 先清空再通知外部，使回调读取active时能得到“全部已释放”的正确状态。
    this.owners.clear();
    for (const midi of active) this.emit({ type: "off", midi });
  }
  get active(): Set<number> {
    return new Set(this.owners.values());
  }
}
interface FingerState {
  key?: PianoKey; // 当前候选琴键；undefined表示区域外。
  since: number; // 进入当前候选琴键的时间，单位毫秒。
  lastSeen: number; // 最近一次观察到这根手指的时间，单位毫秒。
  active: boolean; // 本次停留是否已经触发，用来防止逐帧重复起音。
  point: Point; // 最新的画布坐标。
  confirmedMs: number; // 仅累计连续有效观察支持的时间，丢帧期间不增加。
  interrupted: boolean;
}
/**
 * 每根手指单独维护“区域外 → 候选悬停 → 已触发”的状态。
 * dwell是悬停确认时间，lostTimeout是丢手后的释放等待时间，均以毫秒计算。
 */
export class HoverEngine {
  readonly states = new Map<string, FingerState>();
  cadence = 33;
  private lastUpdate?: number;
  readonly diagnostics = {
    triggers: 0,
    gaps: 0,
    losses: 0,
    changes: 0,
    last: "等待指尖进入琴键",
  };
  /** 适应较慢设备，但最多容忍320ms；容错只保留状态，绝不自动起音。 */
  get graceMs() {
    return Math.min(320, Math.max(160, this.cadence * 2.5));
  }
  private get releaseMs() {
    return Math.max(this.lostTimeout, this.graceMs);
  }
  constructor(
    private notes: NoteOwners,
    public dwell = 100,
    public lostTimeout = 200,
  ) {}
  update(
    fingers: { id: string; point: Point }[],
    keys: PianoKey[],
    now: number,
  ) {
    if (this.lastUpdate !== undefined) {
      const delta = now - this.lastUpdate;
      if (delta > 0 && delta < 500)
        this.cadence = this.cadence * 0.65 + delta * 0.35;
    }
    this.lastUpdate = now;
    // 短暂漏检保留已确认的进度，但返回的第一帧不能把空白期间算成停留。
    const seen = new Set(fingers.map((f) => f.id));
    for (const [id, state] of this.states) {
      if (!seen.has(id)) state.interrupted = true;
    }
    for (const finger of fingers) {
      let state = this.states.get(finger.id);
      if (
        state &&
        now - state.lastSeen > (state.active ? this.releaseMs : this.graceMs)
      ) {
        this.diagnostics.gaps++;
        this.diagnostics.last = "识别中断超时，重新确认";
        this.notes.set(finger.id);
        this.states.delete(finger.id);
        state = undefined;
      }
      const raw = hitKey(keys, finger.point);
      // 三种情况依次处理：
      // 1. 明确进入另一个键：收缩进入边界，避免擦边触发。
      // 2. 仍在旧键或其小范围外沿：保留旧键，减少抖动造成的反复释放。
      // 3. 其余情况：重新命中；没有命中时target为空。
      const target =
        raw && raw.midi !== state?.key?.midi
          ? contains(raw, finger.point, -Math.min(2, raw.w * 0.025))
            ? raw
            : undefined
          : state?.key && contains(state.key, finger.point, state.key.w * 0.035)
            ? state.key
            : hitKey(keys, finger.point, raw ? Math.min(2, raw.w * 0.025) : 0);
      // 初次出现、切换琴键或离开琴键时，释放旧占用并重新建立计时状态。
      if (!state || state.key?.midi !== target?.midi) {
        if (state?.key) {
          this.diagnostics.changes++;
          this.diagnostics.last = target
            ? "切换琴键，重新确认"
            : "指尖已离开琴键";
        }
        this.notes.set(finger.id);
        state = {
          key: target,
          since: now,
          lastSeen: now,
          active: false,
          point: finger.point,
          confirmedMs: 0,
          interrupted: false,
        };
        this.states.set(finger.id, state);
      }
      if (!state.interrupted)
        state.confirmedMs += Math.min(120, Math.max(0, now - state.lastSeen));
      state.interrupted = false;
      state.point = finger.point;
      state.lastSeen = now;
      // 必须命中、尚未起音且停留足够久。active一旦为true，停留期间就不再起音。
      if (target && !state.active && state.confirmedMs >= this.dwell) {
        state.active = true;
        this.diagnostics.triggers++;
        this.diagnostics.last = `${target.note}已触发，移开后可重弹`;
        this.notes.set(finger.id, target.midi);
      }
    }
    this.expire(now);
  }
  /** main.ts每次绘画也会调用：即使识别结果中断，旧手指也能超时释放。 */
  expire(now: number) {
    for (const [id, state] of this.states)
      if (
        now - state.lastSeen >=
        (state.active ? this.releaseMs : this.graceMs)
      ) {
        this.diagnostics.losses++;
        this.diagnostics.last = "指尖识别已超时，已释放";
        this.notes.set(id);
        this.states.delete(id);
      }
  }
  reset() {
    this.notes.releasePrefix("hand:");
    this.states.clear();
    this.lastUpdate = undefined;
    this.cadence = 33;
    this.diagnostics.last = "交互已清空，请重新进入琴键";
  }
  /** 返回0～1的悬停进度，供界面绘制指尖外的进度圆环。 */
  progress(id: string, now: number) {
    const s = this.states.get(id);
    return s?.key && now - s.lastSeen < this.graceMs
      ? Math.min(1, s.confirmedMs / this.dwell)
      : 0;
  }
}
// 保留模型的相对深度z，但当前二维琴键交互只使用x、y，不据此判断真实接触。
export interface Landmark extends Point {
  z?: number;
}
export interface Hand {
  landmarks: Landmark[];
  label: string;
}
interface Track {
  id: number;
  wrist: Point;
  label: string;
  seen: number;
  smooth: Map<number, Point>;
}
/**
 * 给前后帧中的同一只手关联短时身份，再平滑关键点位置。
 * 不能直接用模型数组下标当身份，因为左右手在返回数组中的顺序可能改变。
 */
export class HandTracker {
  private tracks: Track[] = [];
  private next = 1;
  reset() {
    this.tracks = [];
  }
  update(
    hands: Hand[],
    now: number,
  ): { id: number; hand: Hand; points: Landmark[] }[] {
    this.tracks = this.tracks.filter((t) => now - t.seen < 350);
    // 一条旧轨迹在当前帧最多匹配一次，避免两只新手同时借用同一个编号。
    const available = new Set(this.tracks);
    const results = hands.map((hand) => {
      const wrist = hand.landmarks[0];
      // 手腕距离越近越可能是同一只手；标签不一致时增加0.04的比较代价。
      const ranked = [...available]
        .map((t) => ({
          t,
          d:
            Math.hypot(wrist.x - t.wrist.x, wrist.y - t.wrist.y) +
            (t.label !== hand.label ? 0.04 : 0),
        }))
        .sort((a, b) => a.d - b.d);
      // 前两种匹配太接近，或最近轨迹仍太远，都不强行复用身份。
      const ambiguous =
        ranked.length > 1 && Math.abs(ranked[0].d - ranked[1].d) < 0.035;
      let track = !ambiguous && ranked[0]?.d < 0.23 ? ranked[0].t : undefined;
      if (!track) {
        track = {
          id: this.next++,
          wrist,
          label: hand.label,
          seen: now,
          smooth: new Map(),
        };
        this.tracks.push(track);
      }
      available.delete(track);
      // 按时间间隔计算平滑权重：间隔越长越信任新位置，35是毫秒时间常数。
      const alpha = 1 - Math.exp(-Math.max(1, now - track.seen) / 35);
      const points = hand.landmarks.map((p, i) => {
        const old = track!.smooth.get(i);
        const next = old
          ? {
              ...p,
              x: old.x + (p.x - old.x) * alpha,
              y: old.y + (p.y - old.y) * alpha,
            }
          : p;
        track!.smooth.set(i, next);
        return next;
      });
      track.wrist = wrist;
      track.label = hand.label;
      track.seen = now;
      return { id: track.id, hand, points };
    });
    return results;
  }
}
export interface Settings {
  volume: number;
  dwell: number;
  fingers: "index" | "all";
  skeleton: boolean;
  layout: Layout;
}
export const DEFAULT_SETTINGS: Settings = {
  volume: 65,
  dwell: 100,
  fingers: "index",
  skeleton: true,
  layout: DEFAULT_LAYOUT,
};
/** 校验本地存储：无效JSON使用默认值，合法数字也要限制在允许范围内。 */
export function readSettings(raw: string | null): Settings {
  const fallback = structuredClone(DEFAULT_SETTINGS);
  try {
    const data = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object") return fallback;
    // v类型不对时用默认值；数值越界时截到上下限，防止损坏数据破坏界面。
    const num = (v: unknown, def: number, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.max(min, Math.min(max, v))
        : def;
    return {
      volume: num(data.volume, 65, 0, 100),
      dwell: num(data.dwell, 100, 50, 300),
      fingers: data.fingers === "all" ? "all" : "index",
      skeleton: typeof data.skeleton === "boolean" ? data.skeleton : true,
      layout: {
        width: num(data.layout?.width, 84, 50, 96),
        height: num(data.layout?.height, 30, 18, 45),
        x: num(data.layout?.x, 50, 0, 100),
        y: num(data.layout?.y, 64, 0, 100),
      },
    };
  } catch {
    return fallback;
  }
}
