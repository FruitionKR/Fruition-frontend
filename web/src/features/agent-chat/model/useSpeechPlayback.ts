import { useCallback, useEffect, useRef, useState } from "react";
import { streamSpeechSynthesis } from "../api/speech";
import { describeSpeechPlaybackError, SPEECH_PLAYBACK_MESSAGES, SPEECH_SAMPLE_RATE } from "../lib/speechPlayback";

export type SpeechPlaybackStatus = "loading" | "playing";

/** 지금 듣고 있는 답변. loading은 첫 조각을 받기 전, playing은 소리가 나는 중이다. */
export type SpeechPlaybackState = { messageId: string; status: SpeechPlaybackStatus } | null;

export type SpeechPlaybackError = { messageId: string; message: string };

type ActivePlayback = {
  messageId: string;
  controller: AbortController;
  context: AudioContext;
  sources: Set<AudioBufferSourceNode>;
  nextStartAt: number;
  isStreamDone: boolean;
};

// 첫 조각은 현재 시각보다 조금 뒤에 시작해 스케줄 지연으로 앞부분이 잘리지 않게 한다.
const START_LEAD_SECONDS = 0.05;

function isSpeechPlaybackSupported(): boolean {
  return typeof AudioContext !== "undefined";
}

/** 요청을 끊고(서버 합성도 멈춘다) 예약된 소리를 모두 멈춘다. */
function abortPlayback(active: ActivePlayback) {
  active.controller.abort();
  for (const source of active.sources) {
    try {
      source.stop();
    } catch {
      // 아직 시작하지 않았거나 이미 끝난 소스는 무시한다.
    }
  }
  void active.context.close().catch(() => undefined);
}

/**
 * 답변 듣기(#149). 한 번에 하나만 재생하며, 다른 답변을 재생하거나 멈추면 요청을 끊어 서버 합성도 멈춘다.
 * 받은 PCM 조각은 Web Audio 버퍼로 이어 붙여 끊김 없이 재생한다. 세션이 바뀌거나 언마운트되면 멈춘다.
 */
export function useSpeechPlayback(activeSessionId: string | null) {
  const [playback, setPlayback] = useState<SpeechPlaybackState>(null);
  const [error, setError] = useState<SpeechPlaybackError | null>(null);
  const activeRef = useRef<ActivePlayback | null>(null);

  useEffect(() => () => {
    if (activeRef.current) abortPlayback(activeRef.current);
    activeRef.current = null;
  }, []);

  useEffect(() => {
    if (activeRef.current) abortPlayback(activeRef.current);
    activeRef.current = null;
    setPlayback(null);
    setError(null);
  }, [activeSessionId]);

  const stop = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    abortPlayback(active);
    setPlayback(null);
  }, []);

  function finish(active: ActivePlayback) {
    activeRef.current = null;
    void active.context.close().catch(() => undefined);
    setPlayback(null);
  }

  function schedule(active: ActivePlayback, samples: Float32Array) {
    if (samples.length === 0 || activeRef.current !== active) return;
    const buffer = active.context.createBuffer(1, samples.length, SPEECH_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = active.context.createBufferSource();
    source.buffer = buffer;
    source.connect(active.context.destination);
    const startAt = Math.max(active.context.currentTime + START_LEAD_SECONDS, active.nextStartAt);
    source.onended = () => {
      active.sources.delete(source);
      if (active.isStreamDone && active.sources.size === 0 && activeRef.current === active) finish(active);
    };
    const isFirstChunk = active.nextStartAt === 0;
    active.sources.add(source);
    source.start(startAt);
    active.nextStartAt = startAt + buffer.duration;
    if (isFirstChunk) setPlayback({ messageId: active.messageId, status: "playing" });
  }

  async function play(messageId: string) {
    stop();
    setError(null);
    if (!isSpeechPlaybackSupported()) {
      setError({ messageId, message: SPEECH_PLAYBACK_MESSAGES.unsupported });
      return;
    }
    // 클릭 핸들러 안에서 만들어야 자동 재생 정책에 막히지 않는다.
    const context = new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const active: ActivePlayback = {
      messageId,
      controller: new AbortController(),
      context,
      sources: new Set(),
      nextStartAt: 0,
      isStreamDone: false
    };
    activeRef.current = active;
    setPlayback({ messageId, status: "loading" });
    try {
      await streamSpeechSynthesis(messageId, {
        signal: active.controller.signal,
        onAudio: (samples) => schedule(active, samples)
      });
      if (activeRef.current !== active) return;
      active.isStreamDone = true;
      // 오디오 조각이 하나도 없었거나 이미 다 재생됐으면 바로 끝낸다.
      if (active.sources.size === 0) finish(active);
    } catch (caught) {
      if (activeRef.current !== active) return;
      stop();
      const message = describeSpeechPlaybackError(caught);
      if (message) setError({ messageId, message });
    }
  }

  function toggle(messageId: string) {
    if (activeRef.current?.messageId === messageId) stop();
    else void play(messageId);
  }

  return { playback, error, toggle };
}
