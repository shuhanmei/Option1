/** 曲谱是数据，不包含界面或播放逻辑。beats以四分音符为一拍，null表示休止。 */
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

// 用“音高/拍数”人工录入旋律，减少重复书写；这里只处理本项目自带数据。
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
    title: "小星星",
    difficulty: "入门 · 重复音",
    description: "C大调单旋律简化版。练习移开再弹，同一个音也需要重新触发。",
    source:
      "传统旋律；本项目编写C大调教学音符与时值，无歌词、无第三方曲谱文件。",
    bpm: 100,
    steps: melody(`60 60 67 67 69 69 67/2 65 65 64 64 62 62 60/2
      67 67 65 65 64 64 62/2 67 67 65 65 64 64 62/2
      60 60 67 67 69 69 67/2 65 65 64 64 62 62 60/2`),
  },
  {
    id: "ode",
    title: "欢乐颂",
    difficulty: "入门 · 级进",
    description: "主题节选，C大调单旋律简化版。练习相邻白键之间的移动。",
    source:
      "贝多芬《第九交响曲》主题；本项目编写C大调教学节选，无第三方曲谱文件。",
    bpm: 108,
    steps: melody(`64 64 65 67 67 65 64 62 60 60 62 64 64/1.5 62/0.5 62/2
      64 64 65 67 67 65 64 62 60 60 62 64 62/1.5 60/0.5 60/2`),
  },
  {
    id: "brother",
    title: "两只老虎",
    difficulty: "入门 · 八度内移动",
    description: "传统旋律的C大调教学版，低音句移高八度，使用新增的C5琴键。",
    source: "传统旋律；本项目编写教学音符与时值，末句低音G改为G4，无歌词。",
    bpm: 96,
    steps: melody(`60 62 64 60 60 62 64 60 64 65 67/2 64 65 67/2
      67/0.5 69/0.5 67/0.5 65/0.5 64 60 67/0.5 69/0.5 67/0.5 65/0.5 64 60
      60 67 72/2 60 67 72/2`),
  },
  {
    id: "steps",
    title: "指尖小阶梯",
    difficulty: "基础 · 黑键与休止",
    description: "项目原创半音练习。认识全部13个琴键；休止仅在试听中执行。",
    source: "本项目原创练习，随项目源码使用MIT许可。",
    bpm: 90,
    steps: melody(`60 61 62 63 64 65 66 67 68 69 70 71 72/2 -/1
      72 71 70 69 68 67 66 65 64 63 62 61 60/2`),
  },
];

/** 数据入口集中校验：禁止静默折回八度，坏曲谱不能开始试听或练习。 */
export function validateSong(song: Song): string | undefined {
  if (!song.id.trim() || !song.title.trim()) return "曲谱缺少编号或名称。";
  if (!Number.isFinite(song.bpm) || song.bpm < 30 || song.bpm > 240)
    return "曲谱速度必须在30～240 BPM之间。";
  if (
    !song.steps.length ||
    song.steps.length > 1000 ||
    !song.steps.some((s) => s.midi !== null)
  )
    return "曲谱应包含1～1000步，且至少有一个音符。";
  for (const step of song.steps) {
    if (!Number.isFinite(step.beats) || step.beats <= 0 || step.beats > 16)
      return "音符时值必须大于0且不超过16拍。";
    if (
      step.midi !== null &&
      (!Number.isInteger(step.midi) || step.midi < 60 || step.midi > 72)
    )
      return "曲谱超出当前键盘音域（C4～C5），不能开始。";
  }
}

/** 练习忽略休止与时值，只判定实际音符；试听仍保留完整时值。 */
export function practiceNotes(song: Song): number[] {
  return song.steps.flatMap((s) => (s.midi === null ? [] : [s.midi]));
}
