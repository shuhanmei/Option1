/**
 * 音频模块：先加载并解码钢琴采样，再响应on/ off播放或释放音符。
 * 声音通路：单音播放源 → 单音音量 → 总音量 → 动态压缩器 → 系统输出。
 */
export class PianoAudio {
  private context?: AudioContext;
  private master?: GainNode;
  // 已解码采样可反复使用；键为音高编号，值为浏览器可直接播放的声音数据。
  private buffers = new Map<number, AudioBuffer>();
  // 当前仍被按住的播放实例。每次弹奏创建新实例，避免复用一次性播放源。
  private voices = new Map<
    number,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();
  // 已释放但仍在淡出的尾音，与当前按住的音符分开管理。
  private tails = new Set<AudioBufferSourceNode>();
  // 试听使用独立的播放源集合，不占用用户的voices，也不会触发练习判定。
  private scheduled = new Set<AudioBufferSourceNode>();
  // 复用正在进行的加载任务，避免重复点击时并行下载、解码相同采样。
  private load?: Promise<void>;
  volume = 0.65;
  get ready() {
    return this.buffers.size === 5 && this.context?.state === "running";
  }
  get state() {
    return this.context?.state ?? "closed";
  }
  get time() {
    return this.context?.currentTime ?? 0;
  }
  /** 从用户点击事件调用：启用音频上下文，并确保5个采样全部解码后才就绪。 */
  async prepare(onProgress: (n: number) => void = () => {}) {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      // 多音叠加时压低过高峰值；主音量与每个音符自己的音量是独立节点。
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      this.master.gain.value = this.volume;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    const context = this.context;
    // 在网络加载前，从用户点击事件启用声音，满足浏览器的音频自动播放限制。
    await context.resume();
    if (this.buffers.size === 5) return;
    if (!this.load) {
      const pending = (async () => {
        let complete = 0;
        // 先收集到临时表，全部成功后再替换正式采样表，避免半加载状态被当成就绪。
        const local = new Map<number, AudioBuffer>();
        await Promise.all(
          (
            [
              ["C4", 60],
              ["Ds4", 63],
              ["Fs4", 66],
              ["A4", 69],
              ["C5", 72],
            ] as const
          ).map(async ([file, midi]) => {
            const response = await fetch(
              `${import.meta.env.BASE_URL}assets/piano/${file}.mp3`,
              { signal: AbortSignal.timeout(15000) },
            );
            if (!response.ok)
              throw new Error(`采样 ${file} 加载失败 (${response.status})`);
            const buffer = await context.decodeAudioData(
              await response.arrayBuffer(),
            );
            local.set(midi, buffer);
            onProgress(++complete);
          }),
        );
        // 结束后可能已经创建新上下文；旧任务完成时不能覆盖新会话的数据。
        if (context === this.context) this.buffers = local;
      })().finally(() => {
        // 只清理本次加载标记，避免旧任务的finally误删后来启动的新任务。
        if (this.load === pending) this.load = undefined;
      });
      this.load = pending;
    }
    await this.load;
  }
  /** 界面使用0～100，音频节点使用0～1；用短暂平滑过渡避免音量突变。 */
  setVolume(percent: number) {
    this.volume = percent / 100;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.02,
      );
  }
  /** 起音：选择距离目标音高最近的采样，变调后建立一个独立播放实例。 */
  on(midi: number) {
    if (!this.ready || this.voices.has(midi)) return;
    const voice = this.createVoice(midi, this.time);
    this.voices.set(midi, voice);
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      this.tails.delete(voice.source);
      // 同音可能已重新弹奏；旧实例结束时不能删掉新实例的记录。
      if (this.voices.get(midi)?.source === voice.source)
        this.voices.delete(midi);
    };
    voice.source.start();
  }
  /** 用户演奏与曲目试听共用采样创建逻辑，但分别管理播放源的生命周期。 */
  private createVoice(midi: number, when: number) {
    const context = this.context!;
    const sample = [...this.buffers.keys()].sort(
      (a, b) => Math.abs(a - midi) - Math.abs(b - midi),
    )[0];
    const source = context.createBufferSource();
    source.buffer = this.buffers.get(sample)!;
    // 相差12个半音即一个八度：速率乘2；高一个半音则乘2的1/12次方。
    source.playbackRate.value = 2 ** ((midi - sample) / 12);
    const gain = context.createGain();
    // 8毫秒渐入，减少直接从静音跳到目标音量时的爆音。
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.24, when + 0.008);
    source.connect(gain);
    gain.connect(this.master!);
    return { source, gain };
  }
  /** 起音和释放都交给Web Audio时钟，页面刷新变慢不会改变曲谱节奏。 */
  schedule(midi: number, start: number, end: number) {
    if (!this.ready) throw new Error("音色尚未就绪，请重试。");
    const { source, gain } = this.createVoice(midi, start);
    gain.gain.setValueAtTime(0.24, end);
    gain.gain.linearRampToValueAtTime(0, end + 0.12);
    this.scheduled.add(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.scheduled.delete(source);
    };
    source.start(start);
    source.stop(end + 0.13);
  }
  cancelScheduled() {
    for (const source of this.scheduled) {
      try {
        source.stop();
      } catch {
        /* 自然结束的音符无需重复停止。 */
      }
    }
    this.scheduled.clear();
  }
  /** 释放：先从按住列表移除，再让旧实例用120毫秒淡出，允许同音立即重弹。 */
  off(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice || !this.context) return;
    this.voices.delete(midi);
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.12);
    voice.source.stop(now + 0.13);
    this.tails.add(voice.source);
  }
  silence() {
    for (const midi of [...this.voices.keys()]) this.off(midi);
  }
  /** 彻底结束会话：连同淡出尾音一起停止，并关闭浏览器音频上下文。 */
  async close() {
    this.cancelScheduled();
    this.silence();
    for (const source of this.tails) {
      try {
        source.stop();
      } catch {
        // 播放源可能已自然结束，此时不需要再次停止。
      }
    }
    this.tails.clear();
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.buffers.clear();
    this.load = undefined;
    if (context && context.state !== "closed") await context.close();
  }
}
