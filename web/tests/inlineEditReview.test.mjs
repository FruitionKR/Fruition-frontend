import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  }
});

const {
  buildEditReviewSegments,
  composeReviewedMarkdown,
  countPendingProposals,
  countProposals,
  hasAcceptedProposal,
  headingAtLine,
  proposalSourceLabel,
  settleRemainingProposals
} = await import("../src/features/agent-chat/lib/inlineEditReview.ts");
const { prepareMarkdownEditPreview } = await import("../src/features/agent-chat/lib/agentTurn.ts");

const SOURCE = [
  "# 아동의 정서 발달",
  "",
  "## 연구 개요",
  "",
  "첫 문단 원문.",
  "",
  "둘째 문단 원문.",
  "",
  "## 상세 설명",
  "",
  "설명입니다."
].join("\n");

const REPLACEMENT = ["## 연구 개요", "", "첫 문단 요약.", "", "둘째 문단 요약."].join("\n");

function replaceEdit(overrides = {}) {
  return {
    operation: "replace",
    actual_target: { start_line: 3, end_line: 8 },
    replacement_markdown: REPLACEMENT,
    ...overrides
  };
}

test("바뀐 문단마다 제안 하나를 만들고 원문 위치에 둔다", () => {
  const segments = buildEditReviewSegments(SOURCE, replaceEdit());
  assert.equal(countProposals(segments), 2);
  const proposals = segments.filter((segment) => segment.kind === "proposal");
  assert.deepEqual(proposals.map((proposal) => [proposal.index, proposal.originalLines, proposal.proposedLines]), [
    [0, ["첫 문단 원문.", ""], ["첫 문단 요약.", ""]],
    [1, ["둘째 문단 원문.", ""], ["둘째 문단 요약."]]
  ]);
  // 첫 제안 앞에는 제목·소제목이 글 조각으로 남는다.
  assert.deepEqual(segments[0], { kind: "text", lines: ["# 아동의 정서 발달", "", "## 연구 개요", ""] });
});

test("모두 수락하면 기존 편집 미리보기의 결과와 같고, 모두 거절하면 원문 그대로다", () => {
  const segments = buildEditReviewSegments(SOURCE, replaceEdit());
  const request = {
    documentId: "doc-1",
    baseVersion: 3,
    editorSnapshot: { markdown: SOURCE, target: { type: "current_section", startLine: 3, endLine: 8 } }
  };
  const response = {
    documentId: "doc-1",
    baseVersion: 3,
    result: {
      action: "markdown_edit",
      edit: {
        operation: "replace",
        requested_target: { type: "current_section", start_line: 3, end_line: 8 },
        actual_target: { type: "current_section", start_line: 3, end_line: 8 },
        scope_expanded: false,
        changed: true,
        summary: "요약",
        replacement_markdown: REPLACEMENT
      }
    }
  };
  const expected = prepareMarkdownEditPreview(request, response).nextMarkdown;
  assert.equal(composeReviewedMarkdown(segments, settleRemainingProposals(segments, {}, "accepted")), expected);
  assert.equal(composeReviewedMarkdown(segments, settleRemainingProposals(segments, {}, "rejected")), SOURCE);
});

test("일부만 수락하면 그 제안만 반영하고, 남은 제안은 카드의 결정으로 채운다", () => {
  const segments = buildEditReviewSegments(SOURCE, replaceEdit());
  const decisions = { 1: "rejected" };
  assert.equal(countPendingProposals(segments, decisions), 1);
  const settled = settleRemainingProposals(segments, decisions, "accepted");
  assert.deepEqual(settled, { 0: "accepted", 1: "rejected" });
  assert.equal(hasAcceptedProposal(settled), true);
  assert.equal(hasAcceptedProposal({ 0: "rejected" }), false);
  const reviewed = composeReviewedMarkdown(segments, settled);
  assert.ok(reviewed.includes("첫 문단 요약."));
  assert.ok(reviewed.includes("둘째 문단 원문."));
});

test("이어 쓰기 편집은 대상 끝 다음에 지울 원문 없는 제안 하나로 둔다", () => {
  const segments = buildEditReviewSegments(SOURCE, {
    operation: "insert_after",
    actual_target: { start_line: 3, end_line: 8 },
    replacement_markdown: "추가 문단."
  });
  const proposals = segments.filter((segment) => segment.kind === "proposal");
  assert.deepEqual(proposals, [{ kind: "proposal", index: 0, originalLines: [], proposedLines: ["추가 문단."] }]);
  const lines = composeReviewedMarkdown(segments, { 0: "accepted" }).split("\n");
  assert.equal(lines[8], "추가 문단.");
  assert.equal(lines[9], "## 상세 설명");
});

test("같은 문단은 빈 줄 수가 달라도 제안으로 세지 않는다", () => {
  const segments = buildEditReviewSegments("가\n\n나", {
    operation: "replace",
    actual_target: { start_line: 1, end_line: 3 },
    replacement_markdown: "가\n\n\n나"
  });
  assert.equal(countProposals(segments), 0);
  assert.equal(composeReviewedMarkdown(segments, {}), "가\n\n\n나");
});

test("제안 출처와 제목", () => {
  assert.equal(proposalSourceLabel("/research-summary 핵심만"), "/research-summary");
  assert.equal(proposalSourceLabel("연구 개요를 줄여줘"), "AI 편집");
  assert.equal(headingAtLine(SOURCE, 7), "연구 개요");
  assert.equal(headingAtLine(SOURCE, 3), "연구 개요");
  assert.equal(headingAtLine("본문만", 1), null);
});

test("문단 수가 달라도 모두 수락한 결과는 편집안과 같다", () => {
  const source = "가\n\n나\n\n다\n\n라";
  const replacement = "\n가\n\n하나로 합친 문단\n\n라\n추가 줄";
  const segments = buildEditReviewSegments(source, {
    operation: "replace",
    actual_target: { start_line: 1, end_line: 7 },
    replacement_markdown: replacement
  });
  assert.equal(composeReviewedMarkdown(segments, settleRemainingProposals(segments, {}, "accepted")), replacement);
  assert.ok(countProposals(segments) >= 2);
});
