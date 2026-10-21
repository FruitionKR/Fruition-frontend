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
  buildGeneratedMarkdownFilename,
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
