// 마이크 Float32 샘플을 서버가 받는 PCM16 mono little-endian 24kHz로 바꾸는 순수 함수들.

import { LIVE_MAX_FRAME_BYTES, LIVE_SAMPLE_RATE } from "./liveProtocol";

/**
 * inputRate → 24kHz 선형 보간 리샘플러. 조각 경계에서 끊기지 않도록 마지막 샘플과 소수 위치를 이어 간다.
 * Firefox는 다른 sample rate의 AudioContext에 마이크를 연결하지 못해 브라우저 기본 rate로 받고 여기서 줄인다.
 */
export function createResampler(inputRate: number, outputRate = LIVE_SAMPLE_RATE) {
  const step = inputRate / outputRate;
  // 다음 출력 샘플의 위치. 이전 조각의 마지막 샘플(prev)이 -1 위치다.
  let position = 0;
  let previous = 0;
  let hasPrevious = false;
  return (input: Float32Array): Float32Array => {
    if (input.length === 0) return new Float32Array(0);
    if (step === 1) return Float32Array.from(input);
    const output: number[] = [];
    const sampleAt = (index: number) => (index < 0 ? (hasPrevious ? previous : input[0]) : input[index]);
    while (position <= input.length - 1) {
      const left = Math.floor(position);
      const fraction = position - left;
      const a = sampleAt(left);
      const b = input[Math.min(left + 1, input.length - 1)];
      output.push(a + (b - a) * fraction);
      position += step;
    }
    position -= input.length;
    previous = input[input.length - 1];
    hasPrevious = true;
    return Float32Array.from(output);
  };
}

/** [-1, 1] Float32 → PCM16 little-endian bytes. 범위를 넘으면 자른다. */
export function encodePcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

/** 한 frame이 48,000 bytes(1초)를 넘지 않게 자른다. 샘플 경계를 지키도록 짝수 길이로만 자른다. */
export function splitAudioFrames(bytes: Uint8Array, maxBytes = LIVE_MAX_FRAME_BYTES): Uint8Array[] {
  const size = maxBytes - (maxBytes % 2);
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) frames.push(bytes.subarray(offset, offset + size));
  return frames;
}

/** PCM16 bytes의 재생 길이(ms). */
export function pcmDurationMs(byteLength: number, sampleRate = LIVE_SAMPLE_RATE): number {
  return (byteLength / 2 / sampleRate) * 1000;
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** 서버에 자동 발화 감지가 없어 클라이언트가 0.1–30초 구간마다 commit한다. 말이 쉬는 곳에서 끊고 길어지면 강제로 끊는다. */
export const COMMIT_MIN_MS = 2_000;
export const COMMIT_MAX_MS = 15_000;
export const SILENCE_RMS = 0.01;

export function shouldCommit(msSinceCommit: number, chunkRms: number): boolean {
  if (msSinceCommit >= COMMIT_MAX_MS) return true;
  return msSinceCommit >= COMMIT_MIN_MS && chunkRms < SILENCE_RMS;
}
