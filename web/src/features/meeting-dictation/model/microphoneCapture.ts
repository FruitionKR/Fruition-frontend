import { createResampler, encodePcm16, rootMeanSquare } from "../lib/pcm16";

// ScriptProcessor 버퍼 크기. 48kHz에서 약 85ms마다 한 조각이 온다.
const PROCESSOR_BUFFER_SIZE = 4096;

export type MicrophoneCapture = { stop: () => void };

export function isMicrophoneCaptureSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.AudioContext !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * 마이크를 열어 PCM16 mono 24kHz 조각을 onChunk로 넘긴다. getUserMedia 실패(권한 거부 등)는 그대로 던진다.
 * AudioWorklet은 별도 스크립트 모듈을 불러와야 해 CSP(strict-dynamic) 아래에서 막히므로 ScriptProcessor를 쓴다.
 */
export async function startMicrophoneCapture(onChunk: (pcm: Uint8Array, rms: number) => void): Promise<MicrophoneCapture> {
  // 클릭(사용자 제스처) 안에서 만들어야 autoplay 정책에 막혀 suspended로 남지 않는다. 그래서 권한 요청보다 먼저 만든다.
  const context = new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
  } catch (error) {
    void context.close().catch(() => undefined);
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  // ScriptProcessor는 출력이 destination에 이어져야 돈다. 소리는 내지 않는다.
  const mute = context.createGain();
  mute.gain.value = 0;
  const resample = createResampler(context.sampleRate);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const samples = resample(input);
    if (samples.length > 0) onChunk(encodePcm16(samples), rootMeanSquare(input));
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  // 권한 창을 거치며 다시 suspended가 되는 브라우저가 있다. 기다리지 않고 재개만 요청한다.
  if (context.state === "suspended") void context.resume().catch(() => undefined);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    }
  };
}
