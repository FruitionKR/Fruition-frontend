// 채팅 답변 듣기(#149)의 순수 규칙: NDJSON 이벤트 파싱, PCM 조각 이어 붙이기, 오류 문구.
// Web Audio와 fetch를 다루는 쪽은 model/useSpeechPlayback.ts와 api/speech.ts다.
import { ApiError, getErrorMessage } from "@/shared/lib/apiErrors";
import { describeTtsStreamError } from "@/shared/lib/aiErrorCodes";
import type { AgentChatTranslator } from "./agentChatTranslator";
import type { SharedTranslate } from "@/shared/i18n/sharedTranslate";

/** 서버가 보내는 PCM 형식: 16비트 little-endian 모노 24kHz. */
export const SPEECH_SAMPLE_RATE = 24_000;

export type SpeechStreamEvent =
  | { type: "audio"; delta: string }
  | { type: "done" }
  | { type: "error"; code?: string };

/** 스트림이 시작된 뒤 `{"type":"error","code":...}`로 알린 실패. HTTP 오류는 ApiError로 온다. */
export class SpeechStreamError extends Error {
  readonly code?: string;

  constructor(code?: string) {
    super(describeTtsStreamError(code));
    this.name = "SpeechStreamError";
    this.code = code;
  }
}

/** 운영에서 답변 듣기를 끈 403(document SPEECH_SYNTHESIS_DISABLED). 받으면 듣기 버튼을 숨긴다. */
export const SPEECH_SYNTHESIS_DISABLED_CODE = "SPEECH_SYNTHESIS_DISABLED";

export function isSpeechSynthesisDisabledError(error: unknown): boolean {
  return error instanceof ApiError && error.code === SPEECH_SYNTHESIS_DISABLED_CODE;
}

function parseSpeechEventLine(line: string): SpeechStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const event = parsed as { type?: unknown; delta?: unknown; code?: unknown };
  if (event.type === "audio" && typeof event.delta === "string") return { type: "audio", delta: event.delta };
  if (event.type === "done") return { type: "done" };
  if (event.type === "error") return { type: "error", code: typeof event.code === "string" ? event.code : undefined };
  // 모르는 이벤트 종류는 무시한다(서버도 AI의 모르는 이벤트를 무시한다).
  return null;
}

/** NDJSON 텍스트 조각을 이벤트로 바꾼다. 조각이 줄 중간에서 끊겨도 다음 조각과 이어 붙인다. */
export function createSpeechEventParser() {
  let buffer = "";
  return {
    push(text: string): SpeechStreamEvent[] {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.flatMap((line) => {
        const event = parseSpeechEventLine(line);
        return event ? [event] : [];
      });
    },
    /** 스트림이 끝났을 때 줄바꿈 없이 남은 마지막 줄을 처리한다. */
    flush(): SpeechStreamEvent[] {
      const event = parseSpeechEventLine(buffer);
      buffer = "";
      return event ? [event] : [];
    }
  };
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * PCM16 LE 바이트를 Web Audio가 받는 Float32 샘플로 바꾼다.
 * 조각 경계가 샘플(2바이트) 중간에서 갈릴 수 있으므로 남는 1바이트는 다음 조각 앞에 붙인다.
 */
export function createPcmAssembler() {
  let carry: number | null = null;
  return {
    push(bytes: Uint8Array): Float32Array {
      const joined = carry === null ? bytes : concatBytes(carry, bytes);
      const sampleCount = Math.floor(joined.length / 2);
      carry = joined.length % 2 === 1 ? joined[joined.length - 1] : null;
      const view = new DataView(joined.buffer, joined.byteOffset, sampleCount * 2);
      const samples = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768;
      return samples;
    }
  };
}

function concatBytes(first: number, rest: Uint8Array): Uint8Array {
  const joined = new Uint8Array(rest.length + 1);
  joined[0] = first;
  joined.set(rest, 1);
  return joined;
}

/**
 * 재생 실패를 사용자 안내로 바꾼다. 사용자가 멈춘 것(AbortError)은 안내하지 않으므로 null이다.
 * 402 크레딧 부족과 409·422 같은 서버 문구는 getErrorMessage가 그대로 쓰고, 스트림 오류 코드는 한국어로 바꾼다.
 */
export function describeSpeechPlaybackError(error: unknown, t: AgentChatTranslator, tShared?: SharedTranslate): string | null {
  if (error instanceof Error && error.name === "AbortError") return null;
  // fetch가 연결 자체에 실패하면 문구 없는 TypeError를 던진다.
  if (error instanceof TypeError) return t("speech.network");
  if (isSpeechSynthesisDisabledError(error)) return t("speech.disabled");
  // 스트림 오류 코드는 지금 언어의 공용 안내로 바꾼다(오류 객체의 message는 한국어다).
  if (error instanceof SpeechStreamError) return describeTtsStreamError(error.code, tShared);
  return getErrorMessage(error, t("speech.failed"), tShared);
}
