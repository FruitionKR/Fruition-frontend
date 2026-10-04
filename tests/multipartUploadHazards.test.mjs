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

const { PART_UPLOAD_TIMEOUT_MS, uploadPdfMultipart } = await import("../src/entities/document/api/multipartUpload.ts");
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

/** 1개 조각짜리 업로드를 흉내내는 서버. part PUT만 호출자가 정한 동작으로 바꾼다. */
function uploadServer(onPartPut, onComplete) {
  return async (path, init) => {
    if (path === ENDPOINT) return Response.json({ ticket: "tk", part_size: 4, part_count: 1 });
    if (path === `${ENDPOINT}/parts`) return Response.json({ parts: [{ part_number: 1, url: "https://s3.example/part1" }] });
    if (path === `${ENDPOINT}/complete`) return onComplete();
    if (path === `${ENDPOINT}/abort`) return new Response(null, { status: 204 });
    return onPartPut(path, init);
  };
}

const FILE = { name: "a.pdf", size: 4, slice: () => new Blob(["abcd"]) };

test("조각 PUT이 응답하지 않으면 timeout으로 abort되어 업로드가 실패로 끝난다", { timeout: 15_000 }, async (t) => {
  browserEnv(t);
  const timeoutController = new AbortController();
  const requestedTimeouts = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    requestedTimeouts.push(ms);
    return timeoutController.signal;
  });
  let putCalls = 0;
  t.mock.method(globalThis, "fetch", uploadServer(
    (_path, init) => {
      putCalls++;
      // 네트워크가 블랙홀이 된 상황: signal이 abort될 때까지 응답하지 않는다.
      return new Promise((_resolve, reject) => {
        if (init.signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        setTimeout(() => timeoutController.abort(), 10);
      });
    },
    () => Response.json({ id: "doc_1" })
  ));

  await assert.rejects(uploadPdfMultipart(ENDPOINT, FILE, null));

  assert.ok(requestedTimeouts.includes(PART_UPLOAD_TIMEOUT_MS), "조각 PUT에 정해진 timeout을 건다");
  assert.ok(putCalls >= 1);
});

test("complete 5xx 재시도도 조각 전송과 같은 backoff를 지킨다", async (t) => {
  browserEnv(t);
  let completeCalls = 0;
  t.mock.method(globalThis, "fetch", uploadServer(
    async () => new Response(null, { status: 200 }),
    () => {
      completeCalls++;
      return completeCalls < 3
        ? new Response(null, { status: 503 })
        : Response.json({ id: "doc_1" });
    }
  ));

  const startedAt = Date.now();
  const result = await uploadPdfMultipart(ENDPOINT, FILE, null);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.id, "doc_1");
  assert.equal(completeCalls, 3);
  // 500·1000ms backoff를 건너뛰고 즉시 세 번 때리지 않는다.
  assert.ok(elapsed >= 1400, `complete 재시도가 backoff를 지켜야 한다 (elapsed=${elapsed}ms)`);
});
