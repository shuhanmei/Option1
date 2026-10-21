import { practiceNotes, type Song } from "./songs";

/** 按“实际音符序号”截取，保留片段内部的休止和时值。start/end为含头不含尾。 */
export function songSection(song: Song, start: number, end: number): Song {
  const total = practiceNotes(song).length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > total ||
    start >= end
  )
    throw new Error("请选择有效的练习音符范围。");
  let index = -1;
  return {
    ...song,
    steps: song.steps.filter((step) => {
      if (step.midi !== null) index++;
      return (
        index >= start &&
        index < end &&
        !(index === end - 1 && step.midi === null)
      );
    }),
  };
}

export interface PracticeRecord {
  songId: string;
  at: number;
  start: number;
  end: number;
  mistakes: number;
  firstTry: number;
  elapsedMs: number;
}
export const HISTORY_KEY = "air-piano:history:v1";

/** 本地存储也作为不可信输入处理，限制字段、数量和范围；展示使用textContent。 */
export function readHistory(
  raw: string | null,
  songs: readonly Song[],
): PracticeRecord[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is PracticeRecord => {
        if (!row || typeof row !== "object") return false;
        const song = songs.find((song) => song.id === row.songId);
        const total = song ? practiceNotes(song).length : 0;
        return (
          total > 0 &&
          Number.isFinite(row.at) &&
          row.at > 0 &&
          row.at <= 8640000000000000 &&
          Number.isInteger(row.start) &&
          Number.isInteger(row.end) &&
          row.start >= 0 &&
          row.end <= total &&
          row.end > row.start &&
          Number.isInteger(row.mistakes) &&
          row.mistakes >= 0 &&
          row.mistakes <= 1000000 &&
          Number.isInteger(row.firstTry) &&
          row.firstTry >= 0 &&
          row.firstTry <= row.end - row.start &&
          Number.isFinite(row.elapsedMs) &&
          row.elapsedMs >= 0 &&
          row.elapsedMs <= 604800000
        );
      })
      .slice(0, 50)
      .map((row) => ({
        songId: row.songId,
        at: row.at,
        start: row.start,
        end: row.end,
        mistakes: row.mistakes,
        firstTry: row.firstTry,
        elapsedMs: row.elapsedMs,
      }));
  } catch {
    return [];
  }
}
