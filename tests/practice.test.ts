import { describe, it, expect, vi } from "vitest";
import { songSection, readHistory, type PracticeRecord } from "../src/practice";
import { SONGS, practiceNotes } from "../src/songs";
import { SongPlayer } from "../src/song-player";
import { Lesson } from "../src/lesson";

describe("Sections and practice history", () => {
  it("Slice by actual note number, preserving internal rests and excluding adjacent notes", () => {
    const source = {
      ...SONGS[0],
      steps: [
        { midi: null, beats: 1 },
        { midi: 60, beats: 1 },
        { midi: null, beats: 2 },
        { midi: 62, beats: 1 },
        { midi: null, beats: 1 },
        { midi: 64, beats: 1 },
      ],
    };
    expect(songSection(source, 0, 2).steps).toEqual(source.steps.slice(1, 4));
    expect(practiceNotes(songSection(source, 1, 3))).toEqual([62, 64]);
    expect(practiceNotes(songSection(SONGS[0], 0, 42))).toHaveLength(42);
    for (const [a, b] of [
      [-1, 3],
      [2, 2],
      [0, 100],
      [0.5, 3],
    ])
      expect(() => songSection(source, a, b)).toThrow();
  });
  it("Record each mistaken step once, preserve on pause, and clear on a new round", () => {
    const lesson = new Lesson();
    lesson.start(songSection(SONGS[0], 0, 2));
    for (let i = 0; i < 2; i++) {
      lesson.input({ type: "on", midi: 62 });
      lesson.input({ type: "off", midi: 62 });
    }
    expect([...lesson.mistakeSteps]).toEqual([0]);
    lesson.pause();
    lesson.resume();
    expect([...lesson.mistakeSteps]).toEqual([0]);
    lesson.start(SONGS[0]);
    expect(lesson.mistakeSteps.size).toBe(0);
  });
  const row: PracticeRecord = {
    songId: "twinkle",
    at: 1792584000000,
    start: 0,
    end: 2,
    mistakes: 1,
    firstTry: 1,
    elapsedMs: 1000,
  };
  it("Ignore damaged, unknown-song, or out-of-range records; keep 50 and discard extra fields", () => {
    expect(readHistory("broken", SONGS)).toEqual([]);
    expect(readHistory('{"length":1}', SONGS)).toEqual([]);
    expect(
      readHistory(
        JSON.stringify([
          row,
          { ...row, songId: "<script>" },
          { ...row, end: 500 },
          { ...row, firstTry: 3 },
          { ...row, elapsedMs: -1 },
          null,
        ]),
        SONGS,
      ),
    ).toEqual([row]);
    expect(
      readHistory(
        JSON.stringify(Array(80).fill({ ...row, extra: "untrusted" })),
        SONGS,
      ),
    ).toHaveLength(50);
    expect(
      readHistory(JSON.stringify([{ ...row, extra: "untrusted" }]), SONGS)[0],
    ).toEqual(row);
  });
  it("Preview speed changes duration without pitch changes; invalid speeds schedule nothing", () => {
    const audio = { time: 0, schedule: vi.fn(), cancelScheduled: vi.fn() };
    const player = new SongPlayer(audio, vi.fn());
    player.play(songSection(SONGS[0], 0, 1), 0.5);
    expect(audio.schedule).toHaveBeenCalledWith(60, 0.08, 1.22);
    player.stop();
    expect(() => player.play(SONGS[0], 0)).toThrow();
  });
});
