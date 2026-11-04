import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { getWorkspaceId, readWorkspaceId } = await import("../src/shared/api/client.ts");

function withStoredWorkspace(t, value) {
  const original = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => value, removeItem() {}, setItem() {} }, sessionStorage: { getItem: () => null } };
  t.after(() => { globalThis.window = original; });
}

test("로그아웃으로 워크스페이스가 비면 렌더용 읽기는 던지지 않고 빈 값을 준다", (t) => {
  withStoredWorkspace(t, null);
  assert.equal(readWorkspaceId(), "");
  assert.throws(() => getWorkspaceId(), /워크스페이스를 선택해주세요/, "요청을 보낼 때는 그대로 거절한다");
});

test("워크스페이스가 있으면 그 값을 준다", (t) => {
  withStoredWorkspace(t, "ws_1");
  assert.equal(readWorkspaceId(), "ws_1");
});

// 로그아웃은 저장값을 먼저 지우고 화면 이동을 시작한다. 이동이 끝나기 전 재렌더에서 던지면 이동까지 멈춘다.
for (const path of [
  "features/agent-chat/model/useAgentPlanRun.ts",
  "features/agent-chat/model/useDocumentEditPreviews.ts",
  "features/agent-chat/model/useTurnCancelStates.ts",
  "features/agent-chat/ui/AgentPlanTaskDetail.tsx",
  "features/agent-chat/ui/AgentTaskBody.tsx",
  "widgets/agent-panel/model/useDocumentPicker.ts",
  "widgets/agent-panel/model/useSkillSlashPicker.ts"
]) {
  test(`${path}는 렌더 중에 던지는 getWorkspaceId를 쓰지 않는다`, async () => {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /const workspaceId = getWorkspaceId\(\)/);
  });
}
