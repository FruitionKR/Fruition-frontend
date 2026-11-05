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
  buildAgentTurnRequest,
  buildGeneratedMarkdownDocument,
  buildGeneratedMarkdownFilename,
  createInDraftPlacement,
  draftSourceDocumentId,
  resolveDraftPlacement,
  isDocumentCommandAction,
  prepareMarkdownEditPreview,
  resolveChatTurnPresentation,
  resolveGeneratedDocumentFolderId,
  validateMarkdownEditApplication
} = await import("../src/features/agent-chat/lib/agentTurn.ts");

test("채팅 결과를 Query와 문서 명령 두 표현으로 구분한다", () => {
  assert.deepEqual(resolveChatTurnPresentation("chat_answer"), { kind: "query", grounded: true });
  assert.deepEqual(resolveChatTurnPresentation("conversation_reply"), { kind: "query", grounded: false });
  assert.deepEqual(resolveChatTurnPresentation("clarify"), { kind: "query", grounded: false });
  assert.deepEqual(resolveChatTurnPresentation("reject"), { kind: "query", grounded: false });
  assert.deepEqual(resolveChatTurnPresentation("markdown_edit"), {
    kind: "document-command",
    action: "markdown_edit"
  });
  assert.equal(isDocumentCommandAction("markdown_edit"), true);
  assert.equal(isDocumentCommandAction("markdown_create"), true);
  assert.equal(isDocumentCommandAction("chat_answer"), false);
});

test("폴더 내용 조회(folder_lookup)는 문서 명령이 아닌 답변 갈래다", () => {
  assert.equal(isDocumentCommandAction("folder_lookup"), false);
  assert.deepEqual(resolveChatTurnPresentation("folder_lookup"), { kind: "query", grounded: false });
});

const markdownEditContext = {
  documentId: "document-1",
  baseVersion: 3,
  editorSnapshot: {
    markdown: "# 제목\n\n본문",
    target: {
      type: "current_section",
      startLine: 1,
      endLine: 3
    }
  }
};

const agentRequestContext = {
  sessionId: "session-1",
  selectedModel: { provider: "openai", model: "gpt-5-nano" },
  selectedPairIds: []
};

test("Agent turn 요청에 작업 모드와 문서 version·editor snapshot을 고정한다", () => {
  assert.deepEqual(buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, agentRequestContext), {
    session_id: "session-1",
    documentId: "document-1",
    baseVersion: 3,
    message: "본문을 다듬어줘",
    provider: "openai",
    model: "gpt-5-nano",
    allow_web_search: false,
    mode: "task",
    editorSnapshot: markdownEditContext.editorSnapshot
  });
});

test("열린 문서가 없으면 문서 필드를 모두 빼고 작업 모드로 보낸다", () => {
  const request = buildAgentTurnRequest("문서를 주제별 폴더로 정리해줘", null, agentRequestContext);
  assert.deepEqual(request, {
    session_id: "session-1",
    message: "문서를 주제별 폴더로 정리해줘",
    provider: "openai",
    model: "gpt-5-nano",
    allow_web_search: false,
    mode: "task"
  });
  assert.equal("documentId" in request, false);
  assert.equal("editorSnapshot" in request, false);
});

test("문서 없이 보낸 요청의 편집 응답은 미리보기를 만들지 않는다", () => {
  const request = buildAgentTurnRequest("다듬어줘", null, agentRequestContext);
  assert.throws(() => prepareMarkdownEditPreview(request, markdownEditResponse()), /문서를 열고 다시 요청/);
});

test("보기 권한 문서를 연 채 보낸 요청은 편집 문맥 없이 그 문서를 read_only_document_id로 싣는다", () => {
  const request = buildAgentTurnRequest("이 문서를 수정해줘", null, { ...agentRequestContext, readOnlyDocumentId: "doc_read_only" });
  assert.equal(request.read_only_document_id, "doc_read_only");
  assert.equal(request.documentId, undefined);
  assert.equal(request.editorSnapshot, undefined);
});

test("보기 권한 문서가 아니면 read_only_document_id를 싣지 않고, 편집 문맥이 있으면 그쪽을 따른다", () => {
  assert.equal("read_only_document_id" in buildAgentTurnRequest("수정해줘", null, agentRequestContext), false);
  assert.equal("read_only_document_id" in buildAgentTurnRequest("수정해줘", null, { ...agentRequestContext, readOnlyDocumentId: null }), false);
  const editing = buildAgentTurnRequest("수정해줘", markdownEditContext, { ...agentRequestContext, readOnlyDocumentId: "doc_read_only" });
  assert.equal("read_only_document_id" in editing, false);
  assert.equal(editing.documentId, markdownEditContext.documentId);
});

test("첨부한 문서는 reference_document_ids로 싣고 없으면 필드를 뺀다", () => {
  assert.equal("reference_document_ids" in buildAgentTurnRequest("요약해 줘", null, agentRequestContext), false);
  assert.equal("reference_document_ids" in buildAgentTurnRequest("요약해 줘", null, { ...agentRequestContext, referenceDocumentIds: [] }), false);
  const withoutDocument = buildAgentTurnRequest("요약해 줘", null, { ...agentRequestContext, referenceDocumentIds: ["doc_a", "doc_b"] });
  assert.deepEqual(withoutDocument.reference_document_ids, ["doc_a", "doc_b"]);
  assert.equal(withoutDocument.documentId, undefined);
  const withDocument = buildAgentTurnRequest("요약해 줘", markdownEditContext, { ...agentRequestContext, referenceDocumentIds: ["doc_a"] });
  assert.deepEqual(withDocument.reference_document_ids, ["doc_a"]);
  assert.equal(withDocument.documentId, markdownEditContext.documentId);
});

test("첨부는 근거일 뿐이라 편집 대상이 아니다: 첨부 문서를 고친 응답은 미리보기를 만들지 않는다", () => {
  const onlyReference = buildAgentTurnRequest("다듬어줘", null, { ...agentRequestContext, referenceDocumentIds: ["doc_a"] });
  assert.throws(() => prepareMarkdownEditPreview(onlyReference, { ...markdownEditResponse(), documentId: "doc_a" }), /문서를 열고 다시 요청/);
  const withDocument = buildAgentTurnRequest("다듬어줘", markdownEditContext, { ...agentRequestContext, referenceDocumentIds: ["doc_a"] });
  assert.throws(() => prepareMarkdownEditPreview(withDocument, { ...markdownEditResponse(), documentId: "doc_a" }), /요청 문서와 일치하지/);
});

test("선택한 문답은 서버 계약인 selected_pair_ids로 전달한다", () => {
  const request = buildAgentTurnRequest("이어서 다듬어줘", markdownEditContext, {
    ...agentRequestContext,
    selectedPairIds: ["pair-1", "pair-2"]
  });

  assert.deepEqual(request.conversationContext, { selected_pair_ids: ["pair-1", "pair-2"] });
});

test("폴더를 대상으로 고른 요청은 folder_id를 싣고, 폴더가 없으면 키를 싣지 않는다", () => {
  const folderId = "6f1c2a3b-4d5e-4f60-8a71-9b2c3d4e5f60";
  const request = buildAgentTurnRequest("/tidy", null, { ...agentRequestContext, folderId });
  assert.deepEqual(request, {
    session_id: "session-1",
    message: "/tidy",
    provider: "openai",
    model: "gpt-5-nano",
    allow_web_search: false,
    mode: "task",
    folder_id: folderId
  });
  assert.equal("folder_id" in buildAgentTurnRequest("/tidy", null, { ...agentRequestContext, folderId: null }), false);
  assert.equal("folder_id" in buildAgentTurnRequest("/polish", markdownEditContext, agentRequestContext), false);
});

test("새 문서 초안은 turn 응답의 folder_id 폴더에 만들고, 없으면 루트에 만든다", () => {
  assert.equal(resolveGeneratedDocumentFolderId({ folder_id: "folder-uuid" }), "folder-uuid");
  assert.equal(resolveGeneratedDocumentFolderId({ folder_id: null }), null);
  assert.equal(resolveGeneratedDocumentFolderId({}), null);
  assert.equal(resolveGeneratedDocumentFolderId(null), null);
});

test("AI 생성 문서 제목을 안전한 Markdown 파일명으로 변환한다", () => {
  assert.equal(buildGeneratedMarkdownFilename(" API/계약: 초안? "), "API-계약-초안.md");
  assert.equal(buildGeneratedMarkdownFilename("회의록.md"), "회의록.md");
  assert.equal(buildGeneratedMarkdownFilename("   "), "AI 문서.md");
});

test("AI 초안 새 문서는 노트 표시를 붙인 본문과 확장자 없는 표시 이름으로 만든다", () => {
  assert.deepEqual(buildGeneratedMarkdownDocument({ title: " API/계약: 초안? ", summary: "", markdown: "# 초안" }, "ai-note-1"), {
    displayName: "API-계약-초안",
    markdown: "<!-- fruition-note: ai-note-1 -->\n# 초안\n"
  });
  assert.deepEqual(buildGeneratedMarkdownDocument({ title: "회의록.MD", summary: "", markdown: "본문\n" }, "ai-note-2"), {
    displayName: "회의록",
    markdown: "<!-- fruition-note: ai-note-2 -->\n본문\n"
  });
});

function markdownEditResponse(overrides = {}) {
  return {
    documentId: "document-1",
    baseVersion: 3,
    requestId: "request-1",
    result: {
      action: "markdown_edit",
      route: {
        action: "markdown_edit",
        confidence: 0.95,
        reason: "편집 요청",
        edit_goal: "cleanup",
        edit_operation: "replace",
        edit_destination: "target"
      },
      message: null,
      chat: null,
      edit: {
        operation: "replace",
        requested_target: {
          type: "current_section",
          start_line: 1,
          end_line: 3
        },
        actual_target: {
          type: "current_section",
          start_line: 1,
          end_line: 3
        },
        scope_expanded: false,
        changed: true,
        summary: "본문을 정리했습니다.",
        replacement_markdown: "# 제목\n\n정리한 본문"
      },
      generated_markdown: null
    },
    ...overrides
  };
}

test("검증된 replace 응답으로 line diff와 다음 Markdown을 만든다", () => {
  const request = buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, agentRequestContext);
  const preview = prepareMarkdownEditPreview(request, markdownEditResponse());

  assert.equal(preview.nextMarkdown, "# 제목\n\n정리한 본문");
  assert.deepEqual(preview.diffLines, [
    { type: "context", text: "# 제목" },
    { type: "context", text: "" },
    { type: "delete", text: "본문" },
    { type: "insert", text: "정리한 본문" }
  ]);
});

test("insert_after는 현재 section 뒤에 새 Markdown을 추가한다", () => {
  const request = buildAgentTurnRequest("다음 절을 추가해줘", markdownEditContext, agentRequestContext);
  const response = markdownEditResponse({
    result: {
      ...markdownEditResponse().result,
      edit: {
        operation: "insert_after",
        requested_target: {
          type: "current_section",
          start_line: 1,
          end_line: 3
        },
        actual_target: {
          type: "current_section",
          start_line: 1,
          end_line: 3
        },
        scope_expanded: false,
        changed: true,
        summary: "절을 추가했습니다.",
        replacement_markdown: "\n## 다음\n\n추가 본문"
      }
    }
  });

  const preview = prepareMarkdownEditPreview(request, response);

  assert.equal(preview.nextMarkdown, "# 제목\n\n본문\n\n## 다음\n\n추가 본문");
  assert.deepEqual(preview.diffLines, [
    { type: "insert", text: "" },
    { type: "insert", text: "## 다음" },
    { type: "insert", text: "" },
    { type: "insert", text: "추가 본문" }
  ]);
});

test("document_end insert_after는 기존 문서를 지우지 않고 맨 아래에 추가한다", () => {
  const request = buildAgentTurnRequest("문서 아래에 추가해줘", markdownEditContext, agentRequestContext);
  const response = markdownEditResponse({
    result: {
      ...markdownEditResponse().result,
      route: {
        ...markdownEditResponse().result.route,
        edit_goal: "other",
        edit_operation: "insert_after",
        edit_destination: "document_end"
      },
      edit: {
        operation: "insert_after",
        requested_target: {
          type: "current_section",
          start_line: 1,
          end_line: 3
        },
        actual_target: {
          type: "whole_document",
          start_line: 1,
          end_line: 3
        },
        scope_expanded: true,
        changed: true,
        summary: "문서 끝에 추가했습니다.",
        replacement_markdown: "\n## 추가\n\n새 본문"
      }
    }
  });

  const preview = prepareMarkdownEditPreview(request, response);

  assert.equal(preview.nextMarkdown, "# 제목\n\n본문\n\n## 추가\n\n새 본문");
  assert.match(preview.nextMarkdown, /^# 제목\n\n본문/);
});

test("응답 requested target이 요청 target과 다르면 preview를 만들지 않는다", () => {
  const request = buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, agentRequestContext);
  const response = markdownEditResponse({
    result: {
      ...markdownEditResponse().result,
      edit: {
        ...markdownEditResponse().result.edit,
        requested_target: {
          type: "selection",
          start_line: 2,
          end_line: 3
        }
      }
    }
  });

  assert.throws(
    () => prepareMarkdownEditPreview(request, response),
    /편집 대상이 요청 범위와 일치하지 않습니다/
  );
});

test("확장된 actual target을 기준으로 preview를 만든다", () => {
  const context = {
    ...markdownEditContext,
    editorSnapshot: {
      ...markdownEditContext.editorSnapshot,
      target: {
        type: "selection",
        startLine: 3,
        endLine: 3
      }
    }
  };
  const request = buildAgentTurnRequest("문맥을 포함해 다듬어줘", context, agentRequestContext);
  const response = markdownEditResponse({
    result: {
      ...markdownEditResponse().result,
      edit: {
        ...markdownEditResponse().result.edit,
        requested_target: {
          type: "selection",
          start_line: 3,
          end_line: 3
        },
        actual_target: {
          type: "selection",
          start_line: 1,
          end_line: 3
        },
        scope_expanded: true,
        replacement_markdown: "# 제목\n\n문맥을 포함해 정리한 본문"
      }
    }
  });

  assert.equal(
    prepareMarkdownEditPreview(request, response).nextMarkdown,
    "# 제목\n\n문맥을 포함해 정리한 본문"
  );
});

test("요청 이후 editor Markdown이 바뀌면 오래된 결과를 거절한다", () => {
  const request = buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, agentRequestContext);
  const changedContext = {
    ...markdownEditContext,
    editorSnapshot: {
      ...markdownEditContext.editorSnapshot,
      markdown: "# 제목\n\n사용자가 바꾼 본문"
    }
  };

  assert.throws(
    () => validateMarkdownEditApplication(request, markdownEditResponse(), changedContext),
    /요청 이후 문서가 변경되었습니다/
  );
});

test("응답의 문서 version이 요청과 다르면 결과를 거절한다", () => {
  const request = buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, agentRequestContext);

  assert.throws(
    () => prepareMarkdownEditPreview(request, markdownEditResponse({ baseVersion: 4 })),
    /문서 version이 요청과 일치하지 않습니다/
  );
});

const markdownReplacementFixtures = [
  ["요약", "핵심 내용만 남긴 요약입니다."],
  ["번역", "This paragraph was translated."],
  ["문체 변경", "본 기능은 안정적인 편집 경험을 제공합니다."],
  ["Markdown 정리", "## 정리된 제목\n\n정리된 본문"],
  ["표 변환", "| 항목 | 상태 |\n| --- | --- |\n| 편집 | 완료 |"],
  ["checklist 변환", "- [x] 계약 확인\n- [ ] diff 검토"],
  ["회의록 변환", "## 회의 결과\n\n- 결정: diff 승인 후 적용\n- 담당: Frontend"]
];

for (const [name, replacementMarkdown] of markdownReplacementFixtures) {
  test(`${name} Markdown 결과를 변형 없이 다음 buffer에 반영한다`, () => {
    const request = buildAgentTurnRequest(`${name}해줘`, markdownEditContext, agentRequestContext);
    const response = markdownEditResponse({
      result: {
        ...markdownEditResponse().result,
        edit: {
          ...markdownEditResponse().result.edit,
          replacement_markdown: replacementMarkdown
        }
      }
    });

    assert.equal(prepareMarkdownEditPreview(request, response).nextMarkdown, replacementMarkdown);
  });
}

test("웹 서칭 토글이 켜지면 allow_web_search를 true로 보낸다", () => {
  const request = buildAgentTurnRequest("본문을 다듬어줘", markdownEditContext, {
    ...agentRequestContext,
    allowWebSearch: true
  });
  assert.equal(request.allow_web_search, true);
});

test("새 문서 위치: turn의 대상 폴더가 먼저이고, 없으면 원문 폴더, 원문이 없으면 지금처럼 루트다", () => {
  const allowed = () => false;
  assert.deepEqual(resolveDraftPlacement({ targetFolderId: "target", sourceFolderId: "source", isFolderWriteDenied: allowed }), { folderId: "target", canFallBackToRoot: false });
  assert.deepEqual(resolveDraftPlacement({ targetFolderId: null, sourceFolderId: "source", isFolderWriteDenied: allowed }), { folderId: "source", canFallBackToRoot: true });
  // 원문이 루트에 있거나, 문서를 열지 않았거나, 트리에서 못 찾으면 루트다.
  for (const sourceFolderId of [null, undefined]) {
    assert.deepEqual(resolveDraftPlacement({ targetFolderId: null, sourceFolderId, isFolderWriteDenied: allowed }), { folderId: null, canFallBackToRoot: false });
  }
});

test("원문 폴더에 쓸 수 없으면 기본 위치로 만들고, 지정한 대상 폴더는 바꾸지 않는다", () => {
  const denied = () => true;
  assert.deepEqual(resolveDraftPlacement({ targetFolderId: null, sourceFolderId: "source", isFolderWriteDenied: denied }), { folderId: null, canFallBackToRoot: false });
  // 대상 폴더 권한은 수락 화면이 막고 이유를 보여 준다(지금 동작).
  assert.equal(resolveDraftPlacement({ targetFolderId: "target", sourceFolderId: "source", isFolderWriteDenied: denied }).folderId, "target");
});

test("원문 폴더가 서버에서 거절되면(403·404) 기본 위치로 한 번 더 만들어 저장을 지킨다", async () => {
  for (const status of [403, 404]) {
    const calls = [];
    const created = await createInDraftPlacement({ folderId: "source", canFallBackToRoot: true }, async (folderId) => {
      calls.push(folderId);
      if (folderId) throw Object.assign(new Error("거절"), { status });
      return "doc";
    });
    assert.equal(created, "doc");
    assert.deepEqual(calls, ["source", null]);
  }
});

test("다른 실패와 사용자가 지정한 폴더의 실패는 다른 곳에 만들지 않고 그대로 알린다", async () => {
  const failing = (status, calls) => async (folderId) => { calls.push(folderId); throw Object.assign(new Error("실패"), { status }); };
  const serverError = [];
  await assert.rejects(createInDraftPlacement({ folderId: "source", canFallBackToRoot: true }, failing(500, serverError)), /실패/);
  assert.deepEqual(serverError, ["source"]);
  const explicit = [];
  await assert.rejects(createInDraftPlacement({ folderId: "target", canFallBackToRoot: false }, failing(403, explicit)), /실패/);
  assert.deepEqual(explicit, ["target"]);
});

test("보기 권한 문서를 근거로 만든 초안의 원문은 그 문서이고, 칩을 뺐거나 첨부만 했으면 원문이 없다", () => {
  const base = { documentId: null };
  const readOnly = { read_only_document_id: "doc_view", reference_document_ids: ["doc_view", "doc_other"] };
  assert.equal(draftSourceDocumentId(base, readOnly), "doc_view");
  assert.equal(draftSourceDocumentId(base, { read_only_document_id: "doc_view", reference_document_ids: ["doc_other"] }), null, "칩을 뺀 요청");
  assert.equal(draftSourceDocumentId(base, { reference_document_ids: ["doc_other"] }), null, "다른 문서만 첨부한 요청");
  assert.equal(draftSourceDocumentId({ documentId: "doc_open" }, readOnly), "doc_open", "서버가 받은 편집 문서가 먼저다");
  assert.equal(draftSourceDocumentId(base, null), null);
});
