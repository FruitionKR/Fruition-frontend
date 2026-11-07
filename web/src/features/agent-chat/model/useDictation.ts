import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { transcribeSpeech } from "../api/speech";
import {
  DICTATION_MAX_BYTES,
  DICTATION_MAX_MS,
  describeMicrophoneError,
  pickRecordingMimeType,
  type DictationMessageKey
} from "../lib/dictation";

export type DictationStatus = "idle" | "recording" | "transcribing";

type ActiveRecording = { recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout> };

function isDictationSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * 마이크 녹음 → 전사 → onText. 60초가 되면 자동으로 멈추고, 결과는 호출부가 입력창에 채우기만 한다.
 * message는 녹음·전사 상태와 오류 안내다. 무음(text가 빈 문자열)도 안내만 하고 입력창은 건드리지 않는다.
 */
export function useDictation(onText: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const t = useTranslations("agentChat.dictation");
  const tShared = useTranslations("shared");
  const [message, setMessage] = useState<string | null>(null);
  const notify = (key: DictationMessageKey) => setMessage(t(key));
  const activeRef = useRef<ActiveRecording | null>(null);
  const isMountedRef = useRef(true);
  // 전사가 끝날 때의 입력창 내용으로 이어 붙이도록 최신 콜백을 쓴다.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const active = activeRef.current;
      if (!active) return;
      clearTimeout(active.timer);
      if (active.recorder.state !== "inactive") active.recorder.stop();
      stopTracks(active.stream);
      activeRef.current = null;
    };
  }, []);

  async function transcribe(audio: Blob) {
    if (audio.size === 0) {
      setStatus("idle");
      notify("empty");
      return;
    }
    if (audio.size > DICTATION_MAX_BYTES) {
      setStatus("idle");
      notify("tooLarge");
      return;
    }
    setStatus("transcribing");
    notify("transcribing");
    try {
      const text = (await transcribeSpeech(audio)).trim();
      if (!isMountedRef.current) return;
      if (text) {
        onTextRef.current(text);
        setMessage(null);
      } else {
        notify("empty");
      }
    } catch (error) {
      // 402 등 서버가 보낸 문구는 그대로 보여준다.
      if (isMountedRef.current) setMessage(getErrorMessage(error, t("transcribeFailed"), tShared));
    } finally {
      if (isMountedRef.current) setStatus("idle");
    }
  }

  async function start() {
    if (activeRef.current || status !== "idle") return;
    if (!isDictationSupported()) {
      notify("unsupported");
      return;
    }
    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      notify("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      notify(describeMicrophoneError(error));
      return;
    }
    if (!isMountedRef.current) {
      stopTracks(stream);
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      stopTracks(stream);
      clearTimeout(timer);
      const wasActive = activeRef.current?.recorder === recorder;
      activeRef.current = null;
      // 언마운트로 멈춘 녹음은 전사하지 않는다.
      if (wasActive && isMountedRef.current) void transcribe(new Blob(chunks, { type: mimeType }));
    });
    const timer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, DICTATION_MAX_MS);
    activeRef.current = { recorder, stream, timer };
    recorder.start();
    setStatus("recording");
    notify("recording");
  }

  function stop() {
    const active = activeRef.current;
    if (active && active.recorder.state !== "inactive") active.recorder.stop();
  }

  return { status, message, start, stop };
}
