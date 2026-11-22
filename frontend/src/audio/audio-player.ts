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
      try {
        // No forced output sample rate: some devices reject 24000 Hz with NotSupportedError,
        // and because this runs inside the socket message handler that error silently swallowed
        // every audio chunk (the call stayed mute while transcripts kept arriving). Our 24 kHz
        // buffers are resampled to the device rate by the browser.
        this.ctx = new AudioCtx();
        this.nextPlayTime = 0;
      } catch (err) {
        console.error('Could not open the audio output device:', err);
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** Base64 (from the JSON gateway) -> raw PCM bytes. */
  private static base64ToBytes(b64: string): Uint8Array {
    const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Creates/resumes the AudioContext. Call it from a user gesture (the Start button) so the
   * browser never keeps playback suspended, which would leave the call silent.
   */
  public unlock() {
    this.initContext();
  }

  public playChunk(pcmData: ArrayBuffer | Uint8Array | string) {
    if (this.isMuted) return;

    this.initContext();
    if (!this.ctx) return;

    // The gateway may send raw PCM (binary frame) or base64 PCM ({"type":"audio"} JSON)
    let bytes: Uint8Array;
    if (typeof pcmData === 'string') {
      if (!pcmData) return;
      try {
        bytes = StreamAudioPlayer.base64ToBytes(pcmData);
      } catch {
        return;
      }
    } else {
      bytes = pcmData instanceof Uint8Array ? pcmData : new Uint8Array(pcmData);
    }
    if (bytes.byteLength < 2) return;

    // Convert Int16 little-endian to Float32 [-1.0, 1.0]
    const numSamples = Math.floor(bytes.byteLength / 2);
    const int16 = new Int16Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, numSamples);
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
