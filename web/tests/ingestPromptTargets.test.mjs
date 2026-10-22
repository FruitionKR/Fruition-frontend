import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

const { hasBeenIngestedToWiki, ingestPromptMessage, isAwaitingFirstIngest, selectIngestPromptTargets } = await import(
  "../src/features/document-notifications/model/ingestPromptTargets.ts"
);

const doc = (id, status = "uploaded", overrides = {}) => ({
  id, filename: `${id}.md`, mime_type: "text/markdown", status, document_role: "EDITABLE", ...overrides
});

test("카드 대상은 목록에 남아 있고 아직 편입을 시작할 수 있는 문서만, 카드의 순서대로 고른다", () => {
  const documents = [
    doc("c"),
    doc("a", "uploaded", { filename: "새 이름.md" }),
    doc("busy", "processing"),
    doc("done", "completed"),
    doc("edited", "completed", { needs_reingest: true }),
    doc("pdf", "uploaded", { mime_type: "application/pdf" })
  ];
  const targets = selectIngestPromptTargets(["a", "deleted", "busy", "done", "edited", "pdf", "c"], documents);

  assert.deepEqual(targets.map((document) => document.id), ["a", "edited", "c"]);
  assert.equal(targets[0].filename, "새 이름.md");
});

test("문구는 1개면 문서 이름, 여러 개면 개수를 보여 준다", () => {
  assert.equal(ingestPromptMessage([doc("a")]), '"a.md" 문서의 위키 편입을 시작해 보세요.');
  assert.equal(ingestPromptMessage([doc("a"), doc("b")]), "2개 문서의 위키 편입을 시작해 보세요.");
});

test("편입 run이 있는 문서만 편입한 적 있다 (uploaded·PDF 변환만 끝난 문서·직접 만든 노트는 아니다)", () => {
  assert.equal(hasBeenIngestedToWiki(doc("n", "uploaded")), false);
  assert.equal(hasBeenIngestedToWiki(doc("restored", "uploaded", { pipeline_run_id: "run_0" })), false);
  assert.equal(hasBeenIngestedToWiki(doc("c", "completed", { pipeline_run_id: "convert:c" })), false);
  assert.equal(hasBeenIngestedToWiki(doc("note", "completed")), false);
  assert.equal(hasBeenIngestedToWiki(doc("i", "completed", { pipeline_run_id: "run_1" })), true);
  assert.equal(hasBeenIngestedToWiki(doc("f", "failed", { pipeline_run_id: "run_2" })), true);
});

test("첫 편입 대기와 재편입 대상은 겹치지 않는다 — 새 노트는 신규 제안, 편입 후 수정은 재편입 제안", () => {
  const cases = [
    [doc("up", "uploaded"), true, false],
    [doc("note", "completed", { needs_reingest: true }), true, false],
    [doc("converted", "completed", { needs_reingest: true, pipeline_run_id: "convert:x" }), true, false],
    [doc("edited", "completed", { needs_reingest: true, pipeline_run_id: "run_1" }), false, true],
    [doc("fresh", "completed", { needs_reingest: false, pipeline_run_id: "run_1" }), false, false]
  ];
  for (const [document, awaiting, reingest] of cases) {
    assert.equal(isAwaitingFirstIngest(document), awaiting, document.id);
    assert.equal(document.needs_reingest === true && hasBeenIngestedToWiki(document), reingest, document.id);
  }
});

test("채팅 편입 문서는 채팅 편입 완료 알림이 안내하므로 일반 편입 제안(새 문서·대기·정체 리마인드)에서 뺀다", () => {
  // 서버는 채팅 편입 문서를 completed·편입 run 없음·needs_reingest=true로 내려 준다.
  const exported = doc("chatdoc_1", "completed", { ai_origin: "chat_export", needs_reingest: true });
  assert.equal(isAwaitingFirstIngest(exported), false);
  assert.deepEqual(selectIngestPromptTargets(["chatdoc_1"], [exported]), []);
});

test("편입한 적 없는 새 노트는 '수정됨'이 아니라 첫 편입 대기다(pipeline_run_id 규칙)", () => {
  // 직접 만든 노트: completed·run 없음·needs_reingest=true, 업로드한 새 노트: uploaded.
  const direct = doc("note_1", "completed", { needs_reingest: true });
  const uploaded = doc("note_2", "uploaded");
  for (const note of [direct, uploaded]) {
    assert.equal(hasBeenIngestedToWiki(note), false);
    assert.equal(isAwaitingFirstIngest(note), true);
  }
  // 자동 편입이 돌아 run이 생긴 노트를 고친 경우만 '마지막 편입 이후 수정'이다.
  const autoIngested = doc("note_3", "completed", { needs_reingest: true, pipeline_run_id: "run_1" });
  assert.equal(hasBeenIngestedToWiki(autoIngested), true);
  assert.equal(isAwaitingFirstIngest(autoIngested), false);
});
