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

const { skillKindLabel } = await import("../src/entities/skill/model/skillKind.ts");
const { applySlashSkill, slashSkillGroups, slashSkillQuery } = await import("../src/features/agent-chat/lib/skillSlashMenu.ts");

function skill(slug, capabilities, { description = `${slug} 설명`, enabled = true } = {}) {
  const version = { id: `${slug}-v`, name: slug, description, status: "published", version: 1, allowed_tools: [], capabilities, instructions_markdown: "" };
  return { id: slug, workspace_id: "w", owner_user_id: "u", slug, scope_type: "personal", status: "active", enabled_version: enabled ? version : null, latest_version: version };
}

test("스킬 종류 라벨은 capabilities로 정한다(폴더 정리·템플릿·그 밖은 문서)", () => {
  assert.equal(skillKindLabel(["folder-organize"]), "폴더 정리");
  assert.equal(skillKindLabel(["template"]), "템플릿");
  assert.equal(skillKindLabel(["document-edit"]), "문서");
  assert.equal(skillKindLabel([]), "문서");
});

test("입력이 공백 없는 /로 시작할 때만 스킬 검색어를 돌려준다", () => {
  assert.equal(slashSkillQuery("/"), "");
  assert.equal(slashSkillQuery("/meet"), "meet");
  assert.equal(slashSkillQuery("/meeting-summary 정리해줘"), null);
  assert.equal(slashSkillQuery("회의 /meet"), null);
  assert.equal(slashSkillQuery(""), null);
});

test("스킬 목록은 종류별로 묶고(문서 → 폴더 정리 → 템플릿) slug 앞부분·설명으로 거른다", () => {
  const skills = [
    skill("file-organize", ["folder-organize"]),
    skill("meeting-summary", ["document-edit"], { description: "회의 내용을 정리합니다." }),
    skill("weekly-report", ["template"]),
    skill("research-summary", ["document-create", "document-edit"])
  ];
  const all = slashSkillGroups(skills, "");
  assert.deepEqual(all.map((group) => group.label), ["문서", "폴더 정리", "템플릿"]);
  assert.deepEqual(all[0].skills.map((item) => item.slug), ["meeting-summary", "research-summary"]);

  assert.deepEqual(slashSkillGroups(skills, "meet").flatMap((group) => group.skills.map((item) => item.slug)), ["meeting-summary"]);
  assert.deepEqual(slashSkillGroups(skills, "회의").flatMap((group) => group.skills.map((item) => item.slug)), ["meeting-summary"]);
  assert.deepEqual(slashSkillGroups(skills, "없음"), []);
});

test("사용 버전이 없는 스킬은 목록에 넣지 않는다", () => {
  const groups = slashSkillGroups([skill("draft-only", ["document-edit"], { enabled: false })], "");
  assert.deepEqual(groups, []);
});

test("스킬을 고르면 입력을 \"/slug \"로 바꾼다", () => {
  assert.equal(applySlashSkill("meeting-summary"), "/meeting-summary ");
});

const { formatSkillDocumentStamp } = await import("../src/widgets/workspace/lib/skillRunDocument.ts");

test("스킬 실행용 새 문서 이름에는 만든 월.일 시:분을 붙인다", () => {
  assert.equal(formatSkillDocumentStamp(new Date(2026, 9, 19, 9, 5)), "10.19 09:05");
});
