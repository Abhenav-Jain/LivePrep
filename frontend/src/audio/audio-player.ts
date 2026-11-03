/**
 * High-performance, low-latency 24kHz PCM stream audio player with instant barge-in / flush.
 */

export class StreamAudioPlayer {
  private ctx: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onVolumeChange?: (volume: number) => void;
  private isMuted: boolean = false;

  constructor(onVolumeChange?: (volume: number) => void) {
    this.onVolumeChange = onVolumeChange;
  }

  private initContext() {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 24000 });
      this.nextPlayTime = 0;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playChunk(base64Pcm: string) {
    if (this.isMuted) return;

    this.initContext();
    if (!this.ctx) return;

    // Decode base64 to byte array
    const binaryString = atob(base64Pcm);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert Int16 little-endian to Float32 [-1.0, 1.0]
    const int16 = new Int16Array(bytes.buffer);
    const numSamples = int16.length;
    if (numSamples === 0) return;

    const float32 = new Float32Array(numSamples);
    let sumSquares = 0;

    for (let i = 0; i < numSamples; i++) {
      const s = int16[i] / 32768.0;
      float32[i] = s;
      sumSquares += s * s;
    }

    // Audio level for visualizer
    const rms = Math.sqrt(sumSquares / numSamples);
    if (this.onVolumeChange) {
      this.onVolumeChange(rms);
    }

    // Create AudioBuffer at 24000Hz mono
    const buffer = this.ctx.createBuffer(1, numSamples, 24000);
    buffer.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // Schedule seamlessly
    const currentTime = this.ctx.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.02; // Small initial buffer to prevent pops
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    this.activeSources.push(source);

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0 && this.onVolumeChange) {
        this.onVolumeChange(0);
      }
    };
  }

  /**
   * Barge-in interruption handler: immediately stops and cancels all queued audio.
   */
  public flush() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source might have already stopped
      }
    }
    this.activeSources = [];
    if (this.ctx) {
      this.nextPlayTime = this.ctx.currentTime;
    }
    if (this.onVolumeChange) {
      this.onVolumeChange(0);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.flush();
    }
  }

  public close() {
    this.flush();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
