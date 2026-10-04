import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { uploadPdfMultipart } = await import("../src/entities/document/api/multipartUpload.ts");
const { PART_UPLOAD_IDLE_TIMEOUT_MS } = await import("../src/entities/document/api/partUpload.ts");
const { saveAccessToken } = await import("../src/shared/lib/auth.ts");

const ENDPOINT = "/api/workspaces/ws_test/documents/upload";

function browserEnv(t) {
  const original = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === "fruition.workspace_id" ? "ws_test" : null),
      setItem() {},
      removeItem() {}
    }
  };
  t.after(() => {
    globalThis.window = original;
  });
  saveAccessToken("test-access");
}

/** 업로드 진행률을 테스트가 직접 운전하는 XMLHttpRequest 대역. */
function installFakeXhr(t, onSend) {
  const sent = [];
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.status = 0;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(body) {
      this.body = body;
      sent.push(this);
      onSend(this);
    }
    abort() {
      this.onabort?.();
    }
    /** 서버가 응답한 것으로 만든다. */
    respond(status) {
      this.status = status;
      this.onload?.();
    }
    /** 바이트가 올라가는 중임을 알린다. */
    reportProgress() {
      this.upload.onprogress?.();
    }
  }
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  t.after(() => {
    globalThis.XMLHttpRequest = original;
  });
  return sent;
}

/** 1개 조각짜리 업로드를 흉내내는 서버. 조각 PUT은 XMLHttpRequest 대역이 처리한다. */
function uploadServer(onComplete) {
  return async (path) => {
    if (path === ENDPOINT) return Response.json({ ticket: "tk", part_size: 4, part_count: 1 });
    if (path === `${ENDPOINT}/parts`) return Response.json({ parts: [{ part_number: 1, url: "https://s3.example/part1" }] });
    if (path === `${ENDPOINT}/complete`) return onComplete();
    if (path === `${ENDPOINT}/abort`) return new Response(null, { status: 204 });
    throw new Error(`예상하지 못한 요청: ${path}`);
  };
}

const FILE = { name: "a.pdf", size: 4, slice: () => new Blob(["abcd"]) };

/** mock timer를 끝날 때까지 진행시킨다. */
async function settle(t, promise, totalMs, stepMs) {
  let isSettled = false;
  const watched = promise.then(
    (value) => { isSettled = true; return value; },
    (error) => { isSettled = true; throw error; }
  );
  watched.catch(() => {});
  for (let elapsed = 0; elapsed <= totalMs && !isSettled; elapsed += stepMs) {
    t.mock.timers.tick(stepMs);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  }
  return watched;
}

test("진행이 멈춘 조각은 유휴 제한으로 끊겨 업로드가 실패로 끝난다", async (t) => {
  browserEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  // 블랙홀이 된 연결: 응답도, 진행률 보고도 오지 않는다.
  const sent = installFakeXhr(t, () => {});
  t.mock.method(globalThis, "fetch", uploadServer(() => Response.json({ id: "doc_1" })));

  await assert.rejects(
    settle(t, uploadPdfMultipart(ENDPOINT, FILE, null), PART_UPLOAD_IDLE_TIMEOUT_MS * 5, 1_000),
    /응답하지 않아 중단/
  );
  assert.ok(sent.length >= 1, "조각 전송을 시도했다");
});

test("느리지만 계속 올라가는 조각은 유휴 제한에 걸리지 않는다", async (t) => {
  browserEnv(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  // part_size는 서버가 최소 64MiB로 주므로, 느린 회선에서는 한 조각이 몇 분씩 걸린다.
  // 진행률이 계속 오는 동안에는 끊지 않아야 한다.
  let progressTicks = 0;
  installFakeXhr(t, (request) => {
    const pump = () => {
      progressTicks += 1;
      request.reportProgress();
      if (progressTicks >= 10) request.respond(200);
      else setTimeout(pump, PART_UPLOAD_IDLE_TIMEOUT_MS / 2);
    };
    setTimeout(pump, PART_UPLOAD_IDLE_TIMEOUT_MS / 2);
  });
  t.mock.method(globalThis, "fetch", uploadServer(() => Response.json({ id: "doc_slow" })));

  const result = await settle(t, uploadPdfMultipart(ENDPOINT, FILE, null), PART_UPLOAD_IDLE_TIMEOUT_MS * 20, 1_000);

  assert.equal(result.id, "doc_slow");
  assert.equal(progressTicks, 10, "5분 넘게 전송해도 진행 중이면 끝까지 간다");
});

test("AbortSignal.any·AbortSignal.timeout이 없는 브라우저에서도 업로드가 성공한다", async (t) => {
  browserEnv(t);
  // Safari 17.3·Firefox 123 이하를 흉내낸다. 이 API를 쓰면 TypeError로 업로드 전체가 실패한다.
  const originalAny = AbortSignal.any;
  const originalTimeout = AbortSignal.timeout;
  delete AbortSignal.any;
  delete AbortSignal.timeout;
  t.after(() => {
    AbortSignal.any = originalAny;
    AbortSignal.timeout = originalTimeout;
  });
  installFakeXhr(t, (request) => request.respond(200));
  t.mock.method(globalThis, "fetch", uploadServer(() => Response.json({ id: "doc_legacy" })));

  const result = await uploadPdfMultipart(ENDPOINT, FILE, null);

  assert.equal(result.id, "doc_legacy");
});

test("complete 5xx 재시도도 조각 전송과 같은 backoff를 지킨다", async (t) => {
  browserEnv(t);
  installFakeXhr(t, (request) => request.respond(200));
  let completeCalls = 0;
  t.mock.method(globalThis, "fetch", uploadServer(() => {
    completeCalls++;
    return completeCalls < 3
      ? new Response(null, { status: 503 })
      : Response.json({ id: "doc_1" });
  }));

  const startedAt = Date.now();
  const result = await uploadPdfMultipart(ENDPOINT, FILE, null);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.id, "doc_1");
  assert.equal(completeCalls, 3);
  // 500·1000ms backoff를 건너뛰고 즉시 세 번 때리지 않는다.
  assert.ok(elapsed >= 1400, `complete 재시도가 backoff를 지켜야 한다 (elapsed=${elapsed}ms)`);
});
