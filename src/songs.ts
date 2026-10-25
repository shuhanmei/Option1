/** Scores are data, independent of UI/playback. beats uses quarter-note units; null is a rest. */
export interface SongStep {
  midi: number | null;
  beats: number;
}
export interface Song {
  id: string;
  title: string;
  difficulty: string;
  description: string;
  source: string;
  bpm: number;
  steps: readonly SongStep[];
}

export function noteName(midi: number): string {
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      midi % 12
    ] +
    (Math.floor(midi / 12) - 1)
  );
}

// Enter built-in melodies as pitch/beat pairs to avoid repetitive data entry.
function melody(text: string): SongStep[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [pitch, duration = "1"] = token.split("/");
      return {
        midi: pitch === "-" ? null : Number(pitch),
        beats: Number(duration),
      };
    });
}

export const SONGS: readonly Song[] = [
  {
    id: "twinkle",
    title: "Twinkle, Twinkle, Little Star",
    difficulty: "Beginner · Repeated notes",
    description:
      "A simple melody in C major. Practice releasing and repeating notes.",
    source:
      "Traditional melody. Teaching arrangement in C major created for this project; no lyrics or third-party score files.",
    bpm: 100,
    steps: melody(`60 60 67 67 69 69 67/2 65 65 64 64 62 62 60/2
      67 67 65 65 64 64 62/2 67 67 65 65 64 64 62/2
      60 60 67 67 69 69 67/2 65 65 64 64 62 62 60/2`),
  },
  {
    id: "ode",
    title: "Ode to Joy",
    difficulty: "Beginner · Stepwise motion",
    description:
      "A simple theme excerpt in C major. Practice moving between neighboring white keys.",
    source:
      "Theme from Beethoven's Ninth Symphony. Teaching excerpt in C major created for this project; no third-party score files.",
    bpm: 108,
    steps: melody(`64 64 65 67 67 65 64 62 60 60 62 64 64/1.5 62/0.5 62/2
      64 64 65 67 67 65 64 62 60 60 62 64 62/1.5 60/0.5 60/2`),
  },
  {
    id: "brother",
    title: "Frère Jacques",
    difficulty: "Beginner · Within an octave",
    description:
      "A teaching arrangement in C major. The low phrase is raised an octave and uses C5.",
    source:
      "Traditional melody. Teaching arrangement created for this project, with the final low G changed to G4; no lyrics.",
    bpm: 96,
    steps: melody(`60 62 64 60 60 62 64 60 64 65 67/2 64 65 67/2
      67/0.5 69/0.5 67/0.5 65/0.5 64 60 67/0.5 69/0.5 67/0.5 65/0.5 64 60
      60 67 72/2 60 67 72/2`),
  },
  {
    id: "steps",
    title: "Fingertip Steps",
    difficulty: "Basic · Black keys and rests",
    description:
      "An original chromatic exercise covering all 13 keys. Rests apply only to previews.",
    source:
      "Original exercise for this project, released under the MIT license.",
    bpm: 90,
    steps: melody(`60 61 62 63 64 65 66 67 68 69 70 71 72/2 -/1
      72 71 70 69 68 67 66 65 64 63 62 61 60/2`),
  },
];

/** Validate scores at entry: reject invalid data and out-of-range pitches instead of octave folding. */
export function validateSong(song: Song): string | undefined {
  if (!song.id.trim() || !song.title.trim())
    return "The song needs an ID and title.";
  if (!Number.isFinite(song.bpm) || song.bpm < 30 || song.bpm > 240)
    return "Song tempo must be between 30 and 240 BPM.";
  if (
    !song.steps.length ||
    song.steps.length > 1000 ||
    !song.steps.some((s) => s.midi !== null)
  )
    return "A song must have 1–1000 steps and at least one note.";
  for (const step of song.steps) {
    if (!Number.isFinite(step.beats) || step.beats <= 0 || step.beats > 16)
      return "Note duration must be greater than 0 and at most 16 beats.";
    if (
      step.midi !== null &&
      (!Number.isInteger(step.midi) || step.midi < 60 || step.midi > 72)
    )
      return "The song is outside the keyboard range (C4–C5) and cannot start.";
  }
}

/** Practice evaluates notes without rests or durations; previews retain full timing. */
export function practiceNotes(song: Song): number[] {
  return song.steps.flatMap((s) => (s.midi === null ? [] : [s.midi]));
}
