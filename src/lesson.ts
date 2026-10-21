import type { NoteEvent } from "./core";
import { practiceNotes, validateSong, type Song } from "./songs";

export type LessonState =
  | "idle"
  | "playing"
  | "release"
  | "paused"
  | "completed";

/** 纯逻辑练习状态机，不依赖页面、音频或MediaPipe，可使用虚拟时钟测试。 */
export class Lesson {
  state: LessonState = "idle";
  notes: number[] = [];
  index = 0; // 已完成音符数，也就是下一个目标的下标。
  mistakes = 0;
  firstTry = 0;
  private attempted = false;
  private held = new Set<number>();
  private elapsed = 0;
  private since = 0;
  wrong?: { midi: number; until: number };
  readonly mistakeSteps = new Set<number>();

  constructor(private clock: () => number = () => performance.now()) {}

  get target(): number | undefined {
    return this.state === "idle" || this.state === "completed"
      ? undefined
      : this.notes[this.index];
  }
  get active() {
    return this.state === "playing" || this.state === "release";
  }
  get elapsedMs() {
    return this.elapsed + (this.active ? this.clock() - this.since : 0);
  }
  get accuracy() {
    return this.notes.length
      ? Math.round((this.firstTry / this.notes.length) * 100)
      : 0;
  }

  start(song: Song) {
    const error = validateSong(song);
    if (error) throw new Error(error);
    this.reset();
    this.notes = practiceNotes(song);
    this.state = "playing";
    this.since = this.clock();
  }
  reset() {
    this.state = "idle";
    this.notes = [];
    this.index = this.mistakes = this.firstTry = this.elapsed = 0;
    this.attempted = false;
    this.held.clear();
    this.wrong = undefined;
    this.mistakeSteps.clear();
  }
  pause() {
    if (!this.active) return;
    this.elapsed = this.elapsedMs;
    this.state = "paused";
    this.held.clear();
    this.wrong = undefined;
  }
  resume() {
    if (this.state !== "paused") return;
    this.held.clear();
    this.state = "playing";
    this.since = this.clock();
  }

  /** 只接收用户有效on/off。试听走独立通道，绝不调用这里。 */
  input(event: NoteEvent) {
    if (!this.active) return;
    if (event.type === "off") {
      this.held.delete(event.midi);
      if (this.state === "release" && !this.held.size) this.state = "playing";
      return;
    }
    if (this.held.has(event.midi)) return;
    this.held.add(event.midi);
    // 成功后等待所有音符释放，按住多个键不会自动清空后续目标。
    if (this.state === "release") return;
    if (event.midi !== this.target) {
      this.mistakes++;
      this.mistakeSteps.add(this.index);
      this.attempted = true;
      this.wrong = { midi: event.midi, until: this.clock() + 500 };
      return;
    }
    if (!this.attempted) this.firstTry++;
    this.attempted = false;
    this.wrong = undefined;
    this.index++;
    if (this.index === this.notes.length) {
      this.elapsed = this.elapsedMs;
      this.state = "completed";
      this.held.clear();
    } else this.state = "release";
  }
}
