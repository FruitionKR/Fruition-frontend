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

const { buildLogWorkers, logWorkerOf, UNKNOWN_WORKER_NAME } = await import("../src/widgets/log-view/model/logWorker.ts");

const member = (overrides) => ({ user_id: "u", email: "u@x.io", display_name: null, provider: "email", role: "MEMBER", permissions: [], joined_at: "", ...overrides });

test("로그 작업자는 멤버 목록의 이름과 프로필 사진 경로를 쓴다", () => {
  const workers = buildLogWorkers([
    member({ user_id: "u1", display_name: "데모", avatar_url: "/api/users/u1/avatar?v=a" }),
    member({ user_id: "u2", email: "jh@x.io" })
  ]);
  assert.deepEqual(logWorkerOf(workers, "u1"), { name: "데모", avatarUrl: "/api/users/u1/avatar?v=a" });
  // 사진이 없으면 null이라 화면은 기본 프로필 이미지를 보여 준다. 이름이 없으면 이메일.
  assert.deepEqual(logWorkerOf(workers, "u2"), { name: "jh@x.io", avatarUrl: null });
});

test("목록에 없는(탈퇴·미로딩) 작업자는 '알 수 없는 작업자'와 기본 이미지다", () => {
  assert.deepEqual(logWorkerOf(buildLogWorkers(undefined), "gone"), { name: UNKNOWN_WORKER_NAME, avatarUrl: null });
  assert.equal(UNKNOWN_WORKER_NAME, "알 수 없는 작업자");
});
