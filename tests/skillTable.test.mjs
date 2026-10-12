import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSkillsByTab,
  isSkillEnabled,
  needsSkillEnable,
  nextSkillSort,
  skillCommand,
  skillDescription,
  sortSkills
} from "../src/widgets/skills-view/lib/skillTable.ts";

const version = (description) => ({
  id: "v",
  name: "n",
  description,
  status: "published",
  version: 1,
  allowed_tools: [],
  capabilities: [],
  instructions_markdown: ""
});

const skill = (overrides) => ({
  id: "s1",
  workspace_id: "w",
  owner_user_id: "u",
  slug: "meeting-summary",
  scope_type: "personal",
  status: "enabled",
  enabled_version: version("회의 정리"),
  latest_version: version("회의 정리"),
  ...overrides
});

test("enabled 상태라도 게시된 버전이 없으면 사용 중이 아니다", () => {
  assert.equal(isSkillEnabled(skill({})), true);
  assert.equal(isSkillEnabled(skill({ enabled_version: null })), false);
  assert.equal(isSkillEnabled(skill({ status: "disabled" })), false);
});

test("꺼진 스킬은 켤 버전이 있을 때만 자동으로 켠다", () => {
  assert.equal(needsSkillEnable(skill({})), false);
  assert.equal(needsSkillEnable(skill({ status: "disabled" })), true);
  assert.equal(needsSkillEnable(skill({ enabled_version: null })), true);
  assert.equal(needsSkillEnable(skill({ status: "disabled", enabled_version: null, latest_version: null })), false);
});

test("커맨드는 slash + slug, 설명은 게시 버전을 우선한다", () => {
  assert.equal(skillCommand(skill({})), "/meeting-summary");
  assert.equal(skillDescription(skill({ enabled_version: version("게시"), latest_version: version("초안") })), "게시");
  assert.equal(skillDescription(skill({ enabled_version: null, latest_version: version("초안") })), "초안");
  assert.equal(skillDescription(skill({ enabled_version: null, latest_version: null })), "");
});

test("탭은 저장범위로 거른다. personal이 아니면 팀이다", () => {
  const skills = [skill({ id: "p" }), skill({ id: "t", scope_type: "workspace" })];
  assert.deepEqual(filterSkillsByTab(skills, "all").map((item) => item.id), ["p", "t"]);
  assert.deepEqual(filterSkillsByTab(skills, "team").map((item) => item.id), ["t"]);
  assert.deepEqual(filterSkillsByTab(skills, "personal").map((item) => item.id), ["p"]);
});

test("정렬 없으면 서버 순서를 유지하고, 커맨드·저장범위 열로 오름·내림차순 정렬한다", () => {
  const skills = [
    skill({ id: "b", slug: "beta", scope_type: "workspace", status: "disabled" }),
    skill({ id: "a", slug: "alpha" })
  ];
  assert.deepEqual(sortSkills(skills, null).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(sortSkills(skills, { key: "command", direction: "asc" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(sortSkills(skills, { key: "command", direction: "desc" }).map((item) => item.id), ["b", "a"]);
  // 개인이 먼저(오름차순)
  assert.deepEqual(sortSkills(skills, { key: "scope", direction: "asc" }).map((item) => item.id), ["a", "b"]);
  // 원본 배열은 바꾸지 않는다
  assert.deepEqual(skills.map((item) => item.id), ["b", "a"]);
});

test("같은 열을 누르면 오름 → 내림 → 해제 순으로 돈다", () => {
  assert.deepEqual(nextSkillSort(null, "command"), { key: "command", direction: "asc" });
  assert.deepEqual(nextSkillSort({ key: "command", direction: "asc" }, "command"), { key: "command", direction: "desc" });
  assert.equal(nextSkillSort({ key: "command", direction: "desc" }, "command"), null);
  assert.deepEqual(nextSkillSort({ key: "command", direction: "desc" }, "scope"), { key: "scope", direction: "asc" });
});
