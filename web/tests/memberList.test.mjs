import assert from "node:assert/strict";
import test from "node:test";

const { excludeMember, selectVisibleMembers } = await import("../src/features/user-settings/lib/memberList.ts");

const members = [
  { user_id: "u1", email: "metamong@email.com", display_name: "메타몽", role: "OWNER" },
  { user_id: "u2", email: "pikachu@poke.com", display_name: "피카츄", role: "OWNER" },
  { user_id: "u3", email: "charmander@poke.com", display_name: "파이리", role: "MEMBER" },
  { user_id: "u4", email: "nobody@poke.com", display_name: null, role: "MEMBER" }
];

test("전체 멤버를 한국어 순서(한글 먼저)로 이름 오름차순 정렬한다(이름이 없으면 이메일)", () => {
  const visible = selectVisibleMembers(members, { roleFilter: "", search: "", sortDirection: "asc" });
  assert.deepEqual(visible.map((member) => member.user_id), ["u1", "u3", "u2", "u4"]);
});

test("정렬 방향을 바꾸면 이름 내림차순이다", () => {
  const visible = selectVisibleMembers(members, { roleFilter: "", search: "", sortDirection: "desc" });
  assert.deepEqual(visible.map((member) => member.user_id), ["u4", "u2", "u3", "u1"]);
});

test("권한 필터와 이름·이메일 검색을 함께 적용한다(대소문자·앞뒤 공백 무시)", () => {
  assert.deepEqual(
    selectVisibleMembers(members, { roleFilter: "MEMBER", search: "", sortDirection: "asc" }).map((member) => member.user_id),
    ["u3", "u4"]
  );
  assert.deepEqual(
    selectVisibleMembers(members, { roleFilter: "", search: "  POKE.com ", sortDirection: "asc" }).map((member) => member.user_id),
    ["u3", "u2", "u4"]
  );
  assert.deepEqual(
    selectVisibleMembers(members, { roleFilter: "OWNER", search: "메타", sortDirection: "asc" }).map((member) => member.user_id),
    ["u1"]
  );
});

test("원본 배열을 바꾸지 않는다", () => {
  const before = members.map((member) => member.user_id);
  selectVisibleMembers(members, { roleFilter: "", search: "", sortDirection: "desc" });
  assert.deepEqual(members.map((member) => member.user_id), before);
});

test("본인 user_id만 빼고 나머지 멤버는 순서 그대로 남긴다(원본 불변)", () => {
  const others = excludeMember(members, "u1");
  assert.deepEqual(others.map((member) => member.user_id), ["u2", "u3", "u4"]);
  assert.equal(members.length, 4);
});

test("이메일·이름이 같아도 user_id가 다르면 빼지 않는다", () => {
  const lookalike = [...members, { user_id: "u5", email: "metamong@email.com", display_name: "메타몽", role: "MEMBER" }];
  assert.deepEqual(excludeMember(lookalike, "u1").map((member) => member.user_id), ["u2", "u3", "u4", "u5"]);
});

test("다른 멤버가 없으면 빈 목록이고, 본인을 뺀 뒤 필터·검색을 적용한다", () => {
  assert.deepEqual(excludeMember([members[0]], "u1"), []);
  assert.deepEqual(
    selectVisibleMembers(excludeMember(members, "u1"), { roleFilter: "OWNER", search: "", sortDirection: "asc" }).map((member) => member.user_id),
    ["u2"]
  );
});
