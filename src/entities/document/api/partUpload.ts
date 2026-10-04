/**
 * 조각이 이만큼 한 바이트도 나아가지 않으면 블랙홀로 보고 끊는다.
 *
 * 전체 소요 시간을 제한하면 안 된다. 서버가 주는 part_size는 최소 64MiB라
 * 고정 마감은 느리지만 정상인 회선(모바일 등)을 블랙홀과 똑같이 끊어 버린다.
 * 멈춘 시간만 재면 느린 업로드는 끝까지 가고, 응답 없는 연결만 끊긴다.
 */
export const PART_UPLOAD_IDLE_TIMEOUT_MS = 60_000;

export type PartUploadResult = { status: number; ok: boolean };

/**
 * 조각 하나를 PUT하면서 전송이 멈춘 시간만 제한한다.
 *
 * fetch는 업로드 진행률을 볼 수 없어 XMLHttpRequest를 쓴다.
 * AbortSignal.any·AbortSignal.timeout은 Safari 17.4·Firefox 124 이후에만 있어
 * 이 프로젝트가 아직 지원하는 브라우저에서 TypeError로 업로드 전체를 실패시킨다.
 */
export function putPartWithIdleTimeout(
  url: string,
  body: Blob,
  signal: AbortSignal,
  idleTimeoutMs: number = PART_UPLOAD_IDLE_TIMEOUT_MS
): Promise<PartUploadResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("파일 업로드가 중단되었습니다."));
      return;
    }
    const request = new XMLHttpRequest();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let isIdleTimeout = false;

    // 바이트가 올라가는 동안에는 유휴 타이머를 계속 되돌린다.
    function restartIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        isIdleTimeout = true;
        request.abort();
      }, idleTimeoutMs);
    }

    function cleanUp() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      signal.removeEventListener("abort", abortRequest);
    }

    function abortRequest() {
      request.abort();
    }

    signal.addEventListener("abort", abortRequest, { once: true });
    request.open("PUT", url, true);
    // S3 presigned URL은 쿠키를 쓰지 않는다(fetch의 credentials: "omit"과 같다).
    request.withCredentials = false;
    request.upload.onprogress = restartIdleTimer;
    request.onload = () => {
      cleanUp();
      resolve({ status: request.status, ok: request.status >= 200 && request.status < 300 });
    };
    request.onerror = () => {
      cleanUp();
      reject(new Error("파일 조각을 전송하지 못했습니다."));
    };
    request.onabort = () => {
      cleanUp();
      reject(new Error(isIdleTimeout
        ? "파일 조각 전송이 응답하지 않아 중단했습니다."
        : "파일 업로드가 중단되었습니다."));
    };
    // send 전에 타이머를 걸어 둔다. 동기적으로 끝나는 응답에서도 타이머가 남지 않는다.
    restartIdleTimer();
    request.send(body);
  });
}
