import assert from "node:assert/strict";
import test from "node:test";

const {
  canRemoveMember, effectiveSelection, selectAllState, toggleAllSelection, toggleSelection, summarizeMemberNames, removalNotice
} = await import("../src/features/user-settings/lib/memberList.ts");

const owner = { isOwner: true, selfId: "me", ownerCount: 2 };

test("OWNER는 본인이 아닌 멤버와 다른 OWNER를 삭제할 수 있다", () => {
  assert.equal(canRemoveMember({ user_id: "u1", role: "MEMBER" }, owner), true);
  assert.equal(canRemoveMember({ user_id: "u2", role: "OWNER" }, owner), true);
});

test("본인·OWNER가 아닌 사용자·본인 확인 전·마지막 OWNER는 삭제할 수 없다", () => {
  assert.equal(canRemoveMember({ user_id: "me", role: "OWNER" }, owner), false);
  assert.equal(canRemoveMember({ user_id: "u1", role: "MEMBER" }, { ...owner, isOwner: false }), false);
  assert.equal(canRemoveMember({ user_id: "u1", role: "MEMBER" }, { ...owner, selfId: undefined }), false);
  assert.equal(canRemoveMember({ user_id: "u2", role: "OWNER" }, { ...owner, ownerCount: 1 }), false);
});

test("유효 선택은 보이는 삭제 가능 멤버만 표 순서대로 남긴다", () => {
  assert.deepEqual(effectiveSelection(["a", "b", "c"], new Set(["c", "x", "a"])), ["a", "c"]);
});

test("머리 체크 칸은 없음·일부·전부를 false·mixed·true로 보여 준다", () => {
  assert.equal(selectAllState(["a", "b"], new Set()), false);
  assert.equal(selectAllState(["a", "b"], new Set(["a", "hidden"])), "mixed");
  assert.equal(selectAllState(["a", "b"], new Set(["a", "b"])), true);
  assert.equal(selectAllState([], new Set(["a"])), false);
});

test("머리 체크 칸 토글은 보이는 것을 모두 고르거나 모두 풀고 원본을 바꾸지 않는다", () => {
  const partial = new Set(["a", "hidden"]);
  const all = toggleAllSelection(["a", "b"], partial);
  assert.deepEqual([...all].sort(), ["a", "b", "hidden"]);
  assert.deepEqual([...partial].sort(), ["a", "hidden"]);
  assert.deepEqual([...toggleAllSelection(["a", "b"], all)], ["hidden"]);
});

test("행 체크 칸 토글은 새 집합을 돌려준다", () => {
  const base = new Set(["a"]);
  assert.deepEqual([...toggleSelection(base, "b")].sort(), ["a", "b"]);
  assert.deepEqual([...toggleSelection(base, "a")], []);
  assert.deepEqual([...base], ["a"]);
});

test("이름은 5명까지 나열하고 나머지는 외 N명으로 줄인다", () => {
  assert.equal(summarizeMemberNames(["가", "나"]), "「가」, 「나」");
  assert.equal(summarizeMemberNames(["1", "2", "3", "4", "5", "6", "7"]), "「1」, 「2」, 「3」, 「4」, 「5」 외 2명");
});

test("삭제 결과는 성공만이면 완료 문구, 실패가 있으면 성공·실패 수와 이유를 한 번에 알린다", () => {
  assert.deepEqual(removalNotice(3, []), { ok: true, text: "멤버 3명을 삭제했습니다." });
  assert.deepEqual(removalNotice(1, [{ name: "피카츄", reason: "권한이 없습니다." }]), {
    ok: false, text: "성공 1명, 실패 1명 · 「피카츄」: 권한이 없습니다."
  });
  const many = Array.from({ length: 7 }, (_, index) => ({ name: `m${index}`, reason: "오류" }));
  assert.match(removalNotice(0, many).text, /^성공 0명, 실패 7명 · .* · 외 2명$/);
});
