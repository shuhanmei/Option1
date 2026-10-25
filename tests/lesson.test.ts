import { describe, it, expect, vi, afterEach } from "vitest";
import { Lesson } from "../src/lesson";
import { SONGS, validateSong, practiceNotes, type Song } from "../src/songs";
import { SongPlayer, type SongAudio } from "../src/song-player";

const song: Song = {
  id: "test",
  title: "Repeated-note test",
  bpm: 120,
  difficulty: "Test",
  description: "",
  source: "",
  steps: [
    { midi: 60, beats: 1 },
    { midi: 60, beats: 1 },
    { midi: 62, beats: 2 },
  ],
};
const on = (midi: number) => ({ type: "on" as const, midi });
const off = (midi: number) => ({ type: "off" as const, midi });

describe("Note-by-note practice", () => {
  it("Repeated pitches require release; duplicate on events do not advance; the last note completes", () => {
    const lesson = new Lesson();
    lesson.start(song);
    lesson.input(on(60));
    lesson.input(on(60));
    expect(lesson.index).toBe(1);
    expect(lesson.state).toBe("release");
    lesson.input(off(60));
    lesson.input(on(60));
    expect(lesson.index).toBe(2);
    lesson.input(off(60));
    lesson.input(on(62));
    expect(lesson.state).toBe("completed");
    expect(lesson.target).toBeUndefined();
    expect(lesson.accuracy).toBe(100);
    lesson.input(on(61));
    expect(lesson.mistakes).toBe(0);
  });
  it("Only valid attacks count as mistakes and a held future target cannot complete automatically", () => {
    const lesson = new Lesson();
    lesson.start(song);
    lesson.input(on(62));
    lesson.input(on(62));
    expect(lesson.mistakes).toBe(1);
    lesson.input(on(60));
    lesson.input(off(60));
    expect(lesson.state).toBe("release");
    lesson.input(on(60)); // Other keys are still held; this attack must not pass the step.
    expect(lesson.index).toBe(1);
    lesson.input(off(60));
    lesson.input(off(62));
    expect(lesson.state).toBe("playing");
    lesson.input(on(60));
    lesson.input(off(60));
    lesson.input(on(62));
    expect(lesson.firstTry).toBe(2);
    expect(lesson.accuracy).toBe(67);
  });
  it("Pause preserves progress and first-attempt state; elapsed time excludes pauses and cleanup", () => {
    let now = 100;
    const lesson = new Lesson(() => now);
    lesson.start(song);
    lesson.input(on(61));
    now = 1100;
    lesson.pause();
    lesson.input(off(61));
    lesson.input(on(60));
    now = 9100;
    expect(lesson.elapsedMs).toBe(1000);
    expect(lesson.index).toBe(0);
    lesson.resume();
    now = 9600;
    lesson.input(on(60));
    expect(lesson.firstTry).toBe(0);
    expect(lesson.elapsedMs).toBe(1500);
    lesson.start(SONGS[1]);
    expect(lesson.index).toBe(0);
    expect(lesson.mistakes).toBe(0);
    expect(lesson.elapsedMs).toBe(0);
    expect(lesson.target).toBe(64);
  });
  it("Rests affect preview only; completion freezes time and reset rejects old input", () => {
    let now = 0;
    const lesson = new Lesson(() => now);
    lesson.start({
      ...song,
      steps: [
        { midi: null, beats: 1 },
        { midi: 72, beats: 2 },
      ],
    });
    expect(lesson.target).toBe(72);
    now = 500;
    lesson.input(on(72));
    now = 9000;
    expect(lesson.elapsedMs).toBe(500);
    lesson.reset();
    lesson.input(on(72));
    expect(lesson.state).toBe("idle");
    expect(lesson.index).toBe(0);
  });
});

describe("Song validation", () => {
  it("Built-in songs have unique IDs, fit the keyboard, and cover C5", () => {
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    for (const s of SONGS) {
      expect(validateSong(s)).toBeUndefined();
      expect(practiceNotes(s).length).toBeGreaterThan(0);
    }
    expect(practiceNotes(SONGS[2])).toContain(72);
  });
  it.each([
    { ...song, steps: [{ midi: 73, beats: 1 }] },
    { ...song, steps: [{ midi: 59, beats: 1 }] },
    { ...song, steps: [{ midi: 60.5, beats: 1 }] },
    { ...song, steps: [{ midi: 60, beats: 0 }] },
    { ...song, steps: [{ midi: 60, beats: NaN }] },
    { ...song, steps: [{ midi: null, beats: 1 }] },
    { ...song, steps: [] },
    { ...song, bpm: Infinity },
    { ...song, title: "" },
  ])("Reject invalid scores before starting", (invalid) => {
    expect(validateSong(invalid)).toBeTruthy();
    expect(() => new Lesson().start(invalid)).toThrow();
  });
});

describe("Preview scheduling", () => {
  afterEach(() => vi.useRealTimers());
  it("Schedule notes and rests on the audio clock; stop or song changes cancel sources and timers", () => {
    vi.useFakeTimers();
    const audio: SongAudio = {
      time: 10,
      schedule: vi.fn(),
      cancelScheduled: vi.fn(),
    };
    const changed = vi.fn();
    const player = new SongPlayer(audio, changed);
    player.play({
      ...song,
      steps: [
        { midi: 60, beats: 1 },
        { midi: null, beats: 1 },
        { midi: 72, beats: 2 },
      ],
    });
    expect(audio.schedule).toHaveBeenNthCalledWith(1, 60, 10.08, 10.53);
    expect(audio.schedule).toHaveBeenNthCalledWith(2, 72, 11.08, 12.02);
    Object.assign(audio, { time: 10.2 });
    vi.advanceTimersByTime(25);
    expect(player.current).toBe(60);
    Object.assign(audio, { time: 10.8 });
    vi.advanceTimersByTime(25);
    expect(player.current).toBeUndefined();
    player.play(SONGS[1]);
    expect(audio.cancelScheduled).toHaveBeenCalledTimes(2);
    player.stop();
    changed.mockClear();
    vi.advanceTimersByTime(50000);
    expect(player.playing).toBe(false);
    expect(player.current).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("Stop at the audio-clock endpoint and reject invalid scores", () => {
    vi.useFakeTimers();
    const audio = { time: 0, schedule: vi.fn(), cancelScheduled: vi.fn() };
    const player = new SongPlayer(audio, vi.fn());
    player.play(song);
    audio.time = 3;
    vi.advanceTimersByTime(25);
    expect(player.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => player.play({ ...song, bpm: 0 })).toThrow();
    expect(player.playing).toBe(false);
  });
  it("Cancel scheduled notes when scheduling fails partway through", () => {
    vi.useFakeTimers();
    const schedule = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("Audio error");
      });
    const audio = { time: 0, schedule, cancelScheduled: vi.fn() };
    const player = new SongPlayer(audio, vi.fn());
    expect(() => player.play(song)).toThrow("Audio error");
    expect(audio.cancelScheduled).toHaveBeenCalledTimes(2);
    expect(player.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
