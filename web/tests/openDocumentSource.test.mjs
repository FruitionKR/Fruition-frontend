import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { composerSkillIntent, isOpenDocumentOptIn, shouldSendOpenDocument } =
  await import("../src/widgets/agent-panel/lib/openDocumentSource.ts");

const skill = (slug, capabilities, resultMode, status = "enabled") => ({
  id: `skill_${slug}`,
  slug,
  status,
  enabled_version: status === "enabled" ? { capabilities, result_mode: resultMode, targets: [] } : null
});
const SKILLS = [
  skill("make-summary", ["document-create"], "create"),
  skill("polish", ["document-edit"], "edit"),
  skill("smart", ["document-create", "document-edit"], "auto"),
  skill("weekly", ["template"], null),
  skill("tidy", ["folder-organize"], null),
  skill("legacy-create", ["document-create"], null),
  skill("off-create", ["document-create"], "create", "disabled")
];

test("입력의 /slug로 스킬이 하는 일을 찾는다", () => {
  assert.equal(composerSkillIntent("/make-summary 회의 내용 정리", SKILLS), "create");
  assert.equal(composerSkillIntent("/make-summary", SKILLS), "create");
  assert.equal(composerSkillIntent("  /polish 다듬어 줘", SKILLS), "edit");
  assert.equal(composerSkillIntent("/smart", SKILLS), "auto");
  assert.equal(composerSkillIntent("/weekly", SKILLS), "template");
  assert.equal(composerSkillIntent("/tidy", SKILLS), "organize");
  assert.equal(composerSkillIntent("/legacy-create", SKILLS), "create");
});

test("스킬 커맨드가 아니거나 사용 중인 스킬이 아니면 null", () => {
  assert.equal(composerSkillIntent("요약해 줘", SKILLS), null);
  assert.equal(composerSkillIntent("/make-sum", SKILLS), null);
  assert.equal(composerSkillIntent("/off-create", SKILLS), null);
  assert.equal(composerSkillIntent("/make-summary", undefined), null);
  assert.equal(composerSkillIntent("문장 중간 /make-summary", SKILLS), null);
});

test("'새 문서로 만들기' 스킬만 열린 문서를 직접 넣어야 원문으로 쓴다", () => {
  assert.equal(isOpenDocumentOptIn("create"), true);
  for (const intent of [null, "edit", "auto", "template", "organize"]) assert.equal(isOpenDocumentOptIn(intent), false);
});

test("스킬 결과 방식 × 칩 상태 × 멘션 → 열린 문서를 싣는지", () => {
  const cases = [
    // [intent, isExcluded, isOptedIn, hasDocumentMention, expected]
    ["create", false, false, false, false],
    ["create", false, true, false, true],
    ["create", true, false, false, false],
    ["create", true, true, false, true],
    ["create", false, true, true, false],
    [null, false, false, false, true],
    [null, true, false, false, false],
    [null, false, false, true, false],
    ["edit", false, false, false, true],
    ["edit", true, false, false, false],
    ["edit", false, false, true, false],
    ["auto", false, false, false, true],
    ["auto", true, true, false, false],
    ["template", false, false, false, true],
    ["organize", false, false, false, true]
  ];
  for (const [intent, isExcluded, isOptedIn, hasDocumentMention, expected] of cases) {
    assert.equal(
      shouldSendOpenDocument({ intent, isExcluded, isOptedIn, hasDocumentMention }),
      expected,
      JSON.stringify({ intent, isExcluded, isOptedIn, hasDocumentMention })
    );
  }
});
