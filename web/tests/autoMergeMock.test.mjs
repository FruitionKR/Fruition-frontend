import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const { merge3 } = await import("../mock/lib/merge3.mjs");

const BASE = "# 메모\n\n첫 줄\n둘째 줄\n셋째 줄\n넷째 줄\n";

test("목 서버 자동 병합: 떨어진 줄을 고치면 양쪽을 합친다(merged)", () => {
  const theirs = BASE.replace("첫 줄", "첫 줄 (다른 탭)");
  const mine = BASE.replace("넷째 줄", "넷째 줄 (이 탭)");
  assert.deepEqual(merge3(BASE, theirs, mine), {
    markdown: "# 메모\n\n첫 줄 (다른 탭)\n둘째 줄\n셋째 줄\n넷째 줄 (이 탭)\n",
    conflict: false
  });
});

test("목 서버 자동 병합: 같은 줄을 다르게 고치면 나중 저장(mine)이 이긴다(overwritten)", () => {
  const result = merge3(BASE, BASE.replace("둘째 줄", "둘째 줄 A"), BASE.replace("둘째 줄", "둘째 줄 B"));
  assert.equal(result.conflict, true);
  assert.equal(result.markdown, BASE.replace("둘째 줄", "둘째 줄 B"));
});

test("목 서버 자동 병합: 양쪽이 같게 고친 줄은 충돌이 아니다", () => {
  const same = BASE.replace("셋째 줄", "셋째 줄!");
  assert.deepEqual(merge3(BASE, same, same), { markdown: same, conflict: false });
});

test("설정의 문서 관리는 휴지통만 보여 주고 편집 충돌 화면·API는 없다", () => {
  const panel = readFileSync(new URL("../src/features/user-settings/ui/panels/DocumentsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<TrashSection \/>/);
  assert.doesNotMatch(panel, /EditConflict|isOwner/);
  for (const removed of [
    "../src/features/user-settings/ui/panels/collab/EditConflictSection.tsx",
    "../src/features/note-editing/api/editConflict.ts",
    "../src/features/note-editing/model/editConflict.ts"
  ]) {
    assert.equal(existsSync(new URL(removed, import.meta.url)), false, removed);
  }
  const mockRoutes = readFileSync(new URL("../mock/routes/documents.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(mockRoutes, /\/conflicts/);
});
