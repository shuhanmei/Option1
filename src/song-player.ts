import { validateSong, type Song } from "./songs";

export interface SongAudio {
  readonly time: number;
  schedule(midi: number, start: number, end: number): void;
  cancelScheduled(): void;
}

/** 用音频时钟预排短曲，定时器仅更新画面，不承担音符起止计时。 */
export class SongPlayer {
  playing = false;
  current?: number;
  private timer?: ReturnType<typeof setInterval>;
  private timeline: { midi: number | null; start: number; end: number }[] = [];
  constructor(
    private audio: SongAudio,
    private changed: () => void,
  ) {}

  play(song: Song, speed = 1) {
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5)
      throw new Error("试听速度应在0.5～1.5倍之间。");
    const error = validateSong(song);
    if (error) throw new Error(error);
    this.stop();
    let cursor = this.audio.time + 0.08;
    try {
      this.timeline = song.steps.map((step) => {
        const end = cursor + (step.beats * 60) / song.bpm / speed;
        const entry = { midi: step.midi, start: cursor, end };
        if (step.midi !== null)
          this.audio.schedule(
            step.midi,
            cursor,
            end - Math.min(0.06, (end - cursor) * 0.1),
          );
        cursor = end;
        return entry;
      });
    } catch (error) {
      // 途中调度失败也要取消已排入音频时钟的音符。
      this.stop();
      throw error;
    }
    this.playing = true;
    this.changed();
    this.timer = setInterval(() => this.tick(), 25);
  }
  private tick() {
    const now = this.audio.time;
    if (now >= this.timeline[this.timeline.length - 1].end + 0.15) {
      this.stop();
      return;
    }
    const current =
      this.timeline.find((s) => now >= s.start && now < s.end)?.midi ??
      undefined;
    if (current !== this.current) {
      this.current = current;
      this.changed();
    }
  }
  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.audio.cancelScheduled();
    this.playing = false;
    this.current = undefined;
    this.timeline = [];
    this.changed();
  }
}
