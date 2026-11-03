/**
 * AudioWorkletProcessor for recording microphone audio, downsampling to 16000Hz,
 * converting Float32 samples to 16-bit linear PCM (Little-Endian), and buffering ~100ms chunks.
 */

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSampleRate = 16000;
    this.chunkSize = 1600; // 100ms at 16kHz
    this.resampleRatio = 1;
    this.lastSampleRate = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0]; // Mono input
    const inputSampleRate = globalThis.sampleRate || 48000;

    // Resample on the fly using linear interpolation
    const ratio = inputSampleRate / this.targetSampleRate;
    let inIndex = 0;

    while (inIndex < channelData.length) {
      const idx = Math.floor(inIndex);
      const nextIdx = Math.min(idx + 1, channelData.length - 1);
      const fraction = inIndex - idx;

      // Linear interpolation
      const sample = channelData[idx] * (1 - fraction) + channelData[nextIdx] * fraction;

      // Convert float32 [-1.0, 1.0] to 16-bit PCM [-32768, 32767]
      const s = Math.max(-1, Math.min(1, sample));
      const pcm16 = s < 0 ? s * 0x8000 : s * 0x7FFF;

      this.buffer.push(Math.round(pcm16));
      inIndex += ratio;
    }

    // Flush chunks of 1600 samples (100ms @ 16kHz)
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const int16Array = new Int16Array(chunk);

      // Calculate simple RMS for visualizer
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) {
        sum += (chunk[i] / 32768) * (chunk[i] / 32768);
      }
      const rms = Math.sqrt(sum / chunk.length);

      this.port.postMessage({
        pcmData: int16Array.buffer,
        volume: rms
      }, [int16Array.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
