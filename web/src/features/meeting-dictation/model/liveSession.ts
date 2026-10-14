import {
  describeLiveError,
  isFatalLiveError,
  LIVE_CLOSE_IN_USE,
  LIVE_ROLLOVER_MS,
  parseLiveServerEvent,
  type LiveServerEvent
} from "../lib/liveProtocol";
import { pcmDurationMs, shouldCommit, splitAudioFrames } from "../lib/pcm16";

/** 테스트가 가짜 소켓을 넣을 수 있게 브라우저 WebSocket에서 쓰는 부분만 적는다. */
export type LiveSocket = {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
};

export type LiveStopResult = { ok: true } | { ok: false; code: string; message: string };

type LiveSessionOptions = {
  issueTicket: () => Promise<string>;
  openSocket: (ticket: string) => Promise<LiveSocket>;
  /** ready마다(처음·재연결) 불린다. */
  onReady: () => void;
  /** committed·delta·completed */
  onTranscriptEvent: (event: LiveServerEvent) => void;
  onReconnecting: () => void;
  /** 세션이 끝났다. 다시 호출되지 않는다. */
  onStopped: (result: LiveStopResult) => void;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  finishTimeoutMs?: number;
};

const OPEN = 1;
// 연결이 다시 붙는 동안 쌓아 둘 오디오 상한(30초). 넘으면 오래된 것부터 버린다.
const MAX_PENDING_BYTES = 30 * 48_000;

/**
 * 실시간 받아쓰기 연결 하나를 관리한다. ticket 발급 → 접속 → ready 전 오디오는 모아 두었다가 ready 직후 보낸다.
 * 끊기면 새 ticket으로 다시 붙고(최대 maxReconnects번), 55분이 되면 finish 후 새 연결로 넘긴다.
 * finish()는 남은 구간을 저장한 뒤 서버가 finished를 보내고 닫을 때 끝난다.
 */
export function createLiveSession(options: LiveSessionOptions) {
  const { maxReconnects = 3, reconnectDelayMs = 1_000, finishTimeoutMs = 15_000 } = options;
  let socket: LiveSocket | null = null;
  let isReady = false;
  let isStopping = false;
  let isRollingOver = false;
  let isDone = false;
  let reconnects = 0;
  let msSinceCommit = 0;
  let lastError: { code: string; message: string } | null = null;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  function stop(result: LiveStopResult) {
    if (isDone) return;
    isDone = true;
    clearTimers();
    pending = [];
    pendingBytes = 0;
    options.onStopped(result);
  }

  function clearTimers() {
    if (rolloverTimer) clearTimeout(rolloverTimer);
    if (finishTimer) clearTimeout(finishTimer);
    rolloverTimer = null;
    finishTimer = null;
  }

  /** frame을 보내고 구간 길이를 세어 commit한다. 한 구간이 30초를 넘지 않게 COMMIT_MAX_MS마다 강제로 끊는다. */
  function transmit(bytes: Uint8Array, chunkRms: number) {
    for (const frame of splitAudioFrames(bytes)) {
      socket?.send(frame);
      msSinceCommit += pcmDurationMs(frame.length);
      if (shouldCommit(msSinceCommit, chunkRms)) {
        socket?.send(JSON.stringify({ type: "commit" }));
        msSinceCommit = 0;
      }
    }
  }

  function flushPending() {
    // 모아 둔 음성은 쉼을 알 수 없어 길이로만 끊는다.
    for (const bytes of pending) transmit(bytes, 1);
    pending = [];
    pendingBytes = 0;
  }

  async function connect() {
    isReady = false;
    lastError = null;
    msSinceCommit = 0;
    let next: LiveSocket;
    try {
      next = await options.openSocket(await options.issueTicket());
    } catch (error) {
      if (isDone) return;
      // ticket 발급 실패(409 MEETING_LIVE_IN_USE 등)는 서버 문구를 그대로 보여 준다.
      const message = error instanceof Error && error.message ? error.message : describeLiveError("transcription_failed");
      const code = (error as { code?: string } | null)?.code === "MEETING_LIVE_IN_USE" ? "live_in_use" : "ticket_failed";
      if (isStopping || code === "live_in_use" || reconnects >= maxReconnects) {
        stop({ ok: false, code, message });
        return;
      }
      scheduleReconnect();
      return;
    }
    if (isDone) {
      next.close(1000);
      return;
    }
    socket = next;
    next.binaryType = "arraybuffer";
    let finishedReceived = false;
    next.addEventListener("message", (message) => {
      const event = parseLiveServerEvent(message.data);
      if (!event || socket !== next) return;
      if (event.type === "ready") {
        isReady = true;
        reconnects = 0;
        flushPending();
        rolloverTimer = setTimeout(rollover, LIVE_ROLLOVER_MS);
        options.onReady();
        // 멈추는 중에 다시 붙었으면 모아 둔 음성을 보낸 뒤 바로 끝낸다.
        if (isStopping) sendFinish();
      } else if (event.type === "finished") {
        finishedReceived = true;
      } else if (event.type === "error") {
        lastError = { code: event.code, message: describeLiveError(event.code) };
      } else {
        options.onTranscriptEvent(event);
      }
    });
    next.addEventListener("close", (event) => {
      if (socket !== next) return;
      socket = null;
      isReady = false;
      clearTimers();
      handleClose(event.code, finishedReceived);
    });
  }

  function handleClose(code: number, finishedReceived: boolean) {
    if (isDone) return;
    if (code === LIVE_CLOSE_IN_USE) return stop({ ok: false, code: "live_in_use", message: describeLiveError("live_in_use") });
    if (lastError && isFatalLiveError(lastError.code)) return stop({ ok: false, ...lastError });
    if (finishedReceived && isStopping) return stop({ ok: true });
    if (isRollingOver) {
      isRollingOver = false;
      // 정상적으로 넘겼으면 바로, finished 없이 끊겼으면 재연결 규칙대로 새 연결을 연다.
      if (finishedReceived) {
        void connect();
        return;
      }
    }
    if (isStopping) {
      // 멈추는 중 끊겼다. 남은 구간이 저장되지 않았을 수 있다.
      return stop({ ok: false, ...(lastError ?? { code: "disconnected", message: describeLiveError("disconnected") }) });
    }
    if (reconnects >= maxReconnects) {
      return stop({ ok: false, ...(lastError ?? { code: "disconnected", message: describeLiveError("disconnected") }) });
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    reconnects += 1;
    options.onReconnecting();
    setTimeout(() => {
      if (!isDone) void connect();
    }, reconnectDelayMs * reconnects);
  }

  function sendFinish() {
    socket?.send(JSON.stringify({ type: "finish" }));
    if (finishTimer) clearTimeout(finishTimer);
    // finished가 오지 않으면 끊는다(연결은 interrupted로 기록된다). 이후는 close 처리가 정한다.
    finishTimer = setTimeout(() => {
      if (socket) socket.close(1000);
      else if (isStopping) stop({ ok: false, code: "disconnected", message: describeLiveError("transcript_incomplete") });
    }, finishTimeoutMs);
  }

  function rollover() {
    if (isDone || isStopping || !isReady) return;
    isRollingOver = true;
    isReady = false;
    sendFinish();
  }

  return {
    start: () => connect(),
    /** PCM16 24kHz bytes. 연결 전·재연결 중에는 모아 두었다가 ready 직후 보낸다. */
    sendAudio(bytes: Uint8Array, chunkRms: number) {
      if (isDone || isStopping) return;
      if (!isReady || !socket || socket.readyState !== OPEN) {
        pending.push(bytes);
        pendingBytes += bytes.length;
        while (pendingBytes > MAX_PENDING_BYTES && pending.length > 1) pendingBytes -= pending.shift()!.length;
        return;
      }
      transmit(bytes, chunkRms);
    },
    /** 녹음을 멈춘다. 남은 구간을 저장한 뒤 onStopped({ ok: true })가 온다. */
    finish() {
      if (isDone || isStopping) return;
      isStopping = true;
      if (isReady && socket) {
        sendFinish();
        return;
      }
      // 아직 연결 전이면 다시 붙은 뒤(ready) 모아 둔 음성을 보내고 끝낸다. 연결 자체가 없으면 그대로 끝낸다.
      if (!socket && pending.length === 0) stop({ ok: true });
    },
    /** 화면을 떠날 때. 결과를 알리지 않고 닫는다. */
    dispose() {
      isDone = true;
      clearTimers();
      socket?.close(1000);
      socket = null;
    }
  };
}

export type LiveSession = ReturnType<typeof createLiveSession>;
