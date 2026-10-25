/**
 * Load and decode piano samples, then play or release notes in response to on/off events.
 * Signal path: sample source -> per-note gain -> master gain -> compressor -> output.
 */
export class PianoAudio {
  private context?: AudioContext;
  private master?: GainNode;
  // Decoded samples are reusable. Map MIDI pitches to browser-playable audio buffers.
  private buffers = new Map<number, AudioBuffer>();
  // Currently held voices. Each attack creates a new one-shot playback source.
  private voices = new Map<
    number,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();
  // Released voices still fading out, tracked separately from held notes.
  private tails = new Set<AudioBufferSourceNode>();
  // Previews have separate sources; they neither own user voices nor affect practice assessment.
  private scheduled = new Set<AudioBufferSourceNode>();
  // Reuse an in-progress load instead of downloading and decoding the same samples twice.
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
  /** Call from a user gesture: enable audio and wait until all five samples have decoded. */
  async prepare(onProgress: (n: number) => void = () => {}) {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      // Limit polyphonic peaks; master volume and per-note envelopes use separate nodes.
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      this.master.gain.value = this.volume;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    const context = this.context;
    // Enable audio before network loading to comply with browser autoplay restrictions.
    await context.resume();
    if (this.buffers.size === 5) return;
    if (!this.load) {
      const pending = (async () => {
        let complete = 0;
        // Collect in a temporary map and commit only when all samples succeed.
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
              throw new Error(
                `Samples ${file} failed to load (${response.status})`,
              );
            const buffer = await context.decodeAudioData(
              await response.arrayBuffer(),
            );
            local.set(midi, buffer);
            onProgress(++complete);
          }),
        );
        // An old load must not overwrite samples or state in a newly created audio context.
        if (context === this.context) this.buffers = local;
      })().finally(() => {
        // Clear only this load marker so an old finally block cannot erase a newer task.
        if (this.load === pending) this.load = undefined;
      });
      this.load = pending;
    }
    await this.load;
  }
  /** UI volume uses 0-100, audio gain uses 0-1; smooth changes to avoid abrupt jumps. */
  setVolume(percent: number) {
    this.volume = percent / 100;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.02,
      );
  }
  /** Attack: choose the nearest sample, transpose it, and create an independent voice. */
  on(midi: number) {
    if (!this.ready || this.voices.has(midi)) return;
    const voice = this.createVoice(midi, this.time);
    this.voices.set(midi, voice);
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      this.tails.delete(voice.source);
      // An old voice ending must not delete a newer instance of the same note.
      if (this.voices.get(midi)?.source === voice.source)
        this.voices.delete(midi);
    };
    voice.source.start();
  }
  /** User notes and previews share source creation but manage their lifecycles separately. */
  private createVoice(midi: number, when: number) {
    const context = this.context!;
    const sample = [...this.buffers.keys()].sort(
      (a, b) => Math.abs(a - midi) - Math.abs(b - midi),
    )[0];
    const source = context.createBufferSource();
    source.buffer = this.buffers.get(sample)!;
    // Twelve semitones double playback rate; one semitone multiplies it by 2^(1/12).
    source.playbackRate.value = 2 ** ((midi - sample) / 12);
    const gain = context.createGain();
    // Fade in over 8 ms to reduce clicks from a sudden jump in gain.
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.24, when + 0.008);
    source.connect(gain);
    gain.connect(this.master!);
    return { source, gain };
  }
  /** Schedule attacks and releases on the Web Audio clock so redraw delays do not change rhythm. */
  schedule(midi: number, start: number, end: number) {
    if (!this.ready)
      throw new Error("Piano sounds are not ready. Please retry.");
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
        /* Naturally ended sources do not need to be stopped again. */
      }
    }
    this.scheduled.clear();
  }
  /** Release ownership first, then fade the old voice for 120 ms, allowing immediate repetition. */
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
  /** End the session: stop held and fading voices and close the audio context. */
  async close() {
    this.cancelScheduled();
    this.silence();
    for (const source of this.tails) {
      try {
        source.stop();
      } catch {
        // The source may already have ended naturally; no second stop is needed.
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
