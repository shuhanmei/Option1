import type { NoteEvent } from "./core";
import { practiceNotes, validateSong, type Song } from "./songs";

export type LessonState =
  | "idle"
  | "playing"
  | "release"
  | "paused"
  | "completed";

/** Pure practice state machine independent of DOM, audio, and MediaPipe; testable with a virtual clock. */
export class Lesson {
  state: LessonState = "idle";
  notes: number[] = [];
  index = 0; // Completed-note count and index of the next target.
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

  /** Accept only valid user on/off events. Automatic previews never enter this path. */
  input(event: NoteEvent) {
    if (!this.active) return;
    if (event.type === "off") {
      this.held.delete(event.midi);
      if (this.state === "release" && !this.held.size) this.state = "playing";
      return;
    }
    if (this.held.has(event.midi)) return;
    this.held.add(event.midi);
    // After success, wait for all held notes to release; held chords cannot consume later targets.
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
