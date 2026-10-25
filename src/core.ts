/**
 * Interaction rules independent of camera, DOM, and speakers for isolated testing.
 * Data flow: hand association and smoothing -> coordinate mapping -> hit testing -> hover -> ownership events.
 */

/** 2D point. Model coordinates are normalized; mapped canvas coordinates use CSS pixels. */
export interface Point {
  x: number;
  y: number;
}
/** Rectangle: x/y are the top-left corner, w/h are size. Drawing and hit testing share it. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PianoKey extends Rect {
  note: string; // Display note name, such as C4.
  midi: number; // MIDI pitch: C4 is 60, and each semitone changes the value by one.
  black: boolean; // Black keys overlap white keys and take priority in hit testing.
}
/** Layout values are percentages. x/y position the keys within the remaining free space. */
export interface Layout {
  width: number;
  height: number;
  x: number;
  y: number;
}
export const DEFAULT_LAYOUT: Layout = { width: 84, height: 30, x: 50, y: 64 };
// White-key semitone offsets relative to C are not consecutive integers.
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
/** C4-C5: eight white keys and five black keys, returned white first. */
export function makeKeys(
  width: number,
  height: number,
  layout: Layout,
): PianoKey[] {
  const w = (width * layout.width) / 100;
  const h = (height * layout.height) / 100;
  // For width 1000, key width 840, and x=50, the left margin is (1000-840)*50%=80.
  const x = ((width - w) * layout.x) / 100;
  const y = ((height - h) * layout.y) / 100;
  const step = w / WHITE.length;
  // Leave a one-pixel gap on each side of a white key. m sets pitch; i sets position.
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
    // Center black keys on white-key boundaries; 0.29 is half their relative width, 0.58.
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
/** Positive margin expands a rectangle; negative margin contracts it for boundary tolerance. */
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
  // Reverse a copy to prioritize black keys without changing drawing order.
  return [...keys].reverse().find((key) => contains(key, p, -inset));
}
/**
 * Map normalized model points to canvas pixels using the video's object-fit: contain transform.
 * Scale proportionally, add centered margins, and mirror the horizontal coordinate exactly once.
 * sourceWidth/Height describe the video; width/height describe the canvas in CSS pixels.
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
 * Manage note ownership with a map from finger/mouse/keyboard IDs to MIDI pitches.
 * Emit on for the first owner and off for the final owner so fingers do not interrupt each other.
 * The caller supplies emit; main.ts forwards its events to the audio module.
 */
export class NoteOwners {
  private owners = new Map<string, number>();
  constructor(private emit: (event: NoteEvent) => void) {}
  /** Provide midi to press or change a note; omit it to release this input's note. */
  set(owner: string, midi?: number) {
    if (this.owners.get(owner) === midi) return;
    // Remove old ownership before adding new ownership. Unchanged input/note pairs return earlier.
    const old = this.owners.get(owner);
    this.owners.delete(owner);
    if (old !== undefined && ![...this.owners.values()].includes(old))
      this.emit({ type: "off", midi: old });
    // If another input already owns this note, record ownership without another attack.
    if (midi !== undefined) {
      const occupied = [...this.owners.values()].includes(midi);
      this.owners.set(owner, midi);
      if (!occupied) this.emit({ type: "on", midi });
    }
  }
  /** Release only the requested source prefix, such as hand:, leaving mouse and keyboard owners intact. */
  releasePrefix(prefix: string) {
    for (const id of [...this.owners.keys()])
      if (id.startsWith(prefix)) this.set(id);
  }
  reset() {
    const active = this.active;
    // Clear first so callbacks observe an empty active-note set during release notifications.
    this.owners.clear();
    for (const midi of active) this.emit({ type: "off", midi });
  }
  get active(): Set<number> {
    return new Set(this.owners.values());
  }
}
interface FingerState {
  key?: PianoKey; // Current candidate key; undefined means outside all keys.
  since: number; // Time of entry into the current candidate, in milliseconds.
  lastSeen: number; // Last observation time for this fingertip, in milliseconds.
  active: boolean; // Whether this entry has triggered, preventing repeated attacks on subsequent frames.
  point: Point; // Latest point in canvas coordinates.
  confirmedMs: number; // Accumulate time supported by consecutive valid observations, excluding missing frames.
  interrupted: boolean;
}
/**
 * Each fingertip independently transitions through outside, candidate hover, and active states.
 * dwell is confirmation time; lostTimeout is release delay after tracking loss, both in milliseconds.
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
    last: "Waiting for a fingertip over a key",
  };
  /** Adapt to slower devices, capped at 320 ms. Tolerance preserves state but never triggers notes itself. */
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
    // Brief tracking loss preserves progress, but the returning frame cannot count the missing interval.
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
        this.diagnostics.last = "Tracking gap timed out; confirm again";
        this.notes.set(finger.id);
        this.states.delete(finger.id);
        state = undefined;
      }
      const raw = hitKey(keys, finger.point);
      // Handle these cases in order:
      // 1. Entering another key: contract the entry boundary to avoid edge triggers.
      // 2. Remaining in the old key or its small outer margin: preserve it to reduce jitter.
      // 3. Otherwise perform a fresh hit test; no hit leaves target undefined.
      const target =
        raw && raw.midi !== state?.key?.midi
          ? contains(raw, finger.point, -Math.min(2, raw.w * 0.025))
            ? raw
            : undefined
          : state?.key && contains(state.key, finger.point, state.key.w * 0.035)
            ? state.key
            : hitKey(keys, finger.point, raw ? Math.min(2, raw.w * 0.025) : 0);
      // On first appearance, key change, or exit, release old ownership and restart timing.
      if (!state || state.key?.midi !== target?.midi) {
        if (state?.key) {
          this.diagnostics.changes++;
          this.diagnostics.last = target
            ? "Key changed; confirm again"
            : "Fingertip left the key";
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
      // Trigger only with a hit, no previous attack, and sufficient confirmed time.
      if (target && !state.active && state.confirmedMs >= this.dwell) {
        state.active = true;
        this.diagnostics.triggers++;
        this.diagnostics.last = `${target.note} played; move away to repeat`;
        this.notes.set(finger.id, target.midi);
      }
    }
    this.expire(now);
  }
  /** Called by draw as well: old fingers still time out if tracking results stop arriving. */
  expire(now: number) {
    for (const [id, state] of this.states)
      if (
        now - state.lastSeen >=
        (state.active ? this.releaseMs : this.graceMs)
      ) {
        this.diagnostics.losses++;
        this.diagnostics.last = "Tracking timed out; note released";
        this.notes.set(id);
        this.states.delete(id);
      }
  }
  reset() {
    this.notes.releasePrefix("hand:");
    this.states.clear();
    this.lastUpdate = undefined;
    this.cadence = 33;
    this.diagnostics.last = "Input cleared; move into a key again";
  }
  /** Return hover progress from 0 to 1 for the fingertip progress ring. */
  progress(id: string, now: number) {
    const s = this.states.get(id);
    return s?.key && now - s.lastSeen < this.graceMs
      ? Math.min(1, s.confirmedMs / this.dwell)
      : 0;
  }
}
// Keep relative depth z, but this 2D interaction uses x/y and does not infer physical contact.
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
 * Associate the same hand across nearby frames, then smooth landmark positions.
 * Do not use the detection array index as identity: left/right order can change.
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
    // Match an old track at most once per frame so two hands cannot borrow the same ID.
    const available = new Set(this.tracks);
    const results = hands.map((hand) => {
      const wrist = hand.landmarks[0];
      // Closer wrists are more likely to match; a handedness mismatch adds a cost of 0.04.
      const ranked = [...available]
        .map((t) => ({
          t,
          d:
            Math.hypot(wrist.x - t.wrist.x, wrist.y - t.wrist.y) +
            (t.label !== hand.label ? 0.04 : 0),
        }))
        .sort((a, b) => a.d - b.d);
      // Do not force identity reuse when candidates are ambiguous or the nearest is too far away.
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
      // Use elapsed-time smoothing: longer gaps trust new positions more; the time constant is 35 ms.
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
/** Validate stored settings: malformed JSON uses defaults, and numbers are clamped to allowed ranges. */
export function readSettings(raw: string | null): Settings {
  const fallback = structuredClone(DEFAULT_SETTINGS);
  try {
    const data = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object") return fallback;
    // Use defaults for wrong types and clamp bounds so damaged storage cannot break the interface.
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
