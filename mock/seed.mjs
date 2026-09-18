// 데모 계정·워크스페이스·문서·위키·로그·스킬 초기 데이터.
import { state, now, minutesAgo, hash } from "./state.mjs";

export const DEMO_EMAIL = "demo@fruition.local";
export const DEMO_PASSWORD = "demo1234";
export const WORKSPACE_ID = "ws_fruition";
const USER_ID = "user_demo";
const MEMBER_ID = "user_jihyun";

const INTRO_MD = `# Fruition 프로젝트 소개

Fruition은 팀의 문서를 업로드하면 자동으로 위키 페이지와 지식 그래프를 만들어 주는 서비스입니다.

## 핵심 흐름

1. 문서를 워크스페이스에 업로드한다.
2. Ingest 파이프라인이 문서를 분석해 source 페이지와 concept 페이지를 생성한다.
3. 채팅에서 질문하면 위키와 원문 근거를 함께 답한다.

## 구성 요소

- Access 서비스: 인증·워크스페이스·멤버 관리
- Document 서비스: 문서·위키·채팅·AI 작업 로그
- AI 파이프라인: Ingest, Lint, 질의 응답
`;

const ARCH_MD = `# 아키텍처 개요

## 서비스 경계

프론트엔드는 \`/api/*\`를 호출하고 Next.js rewrite가 Access(8081)와 Document(8080)로 전달합니다.

## Ingest 파이프라인

Ingest는 편집 가능한 Markdown만 입력으로 받습니다. PDF 등 원본 문서는 먼저 Markdown 변환을 거칩니다.

## Lint

Lint는 마지막 실행 이후 바뀐 위키 페이지를 다듬고 중복 개념을 병합합니다.
`;

const PAPER_MD = `<!-- page 1 -->
# 지식 그래프 기반 문서 검색

## 초록

본 문서는 RAG 검색에서 지식 그래프를 활용해 근거 문단을 선별하는 방법을 설명합니다.

<!-- page 2 -->
## 방법

source 페이지와 concept 페이지를 연결한 그래프에서 질문과 가까운 노드를 우선 탐색합니다.
`;

const NOTES_MD = `# 회의 노트 초안

- 다음 스프린트 목표: Lint 자동화
- 담당: 지현
`;

const TODO_MD = `# 할 일

- [ ] 온보딩 문서 작성
- [ ] 그래프 색상 정리
`;

const MEETING_TXT = `2026-09-10 주간 회의
- 위키 반영 흐름 점검
- 멤버 초대 UX 개선 논의
`;

/** 브라우저에서 열리는 최소 단일 페이지 PDF. */
export function buildPdf(text) {
  const content = `BT /F1 20 Tf 60 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function document(partial) {
  const markdown = partial.markdown ?? null;
  const content = partial.content ?? (markdown !== null ? Buffer.from(markdown, "utf8") : Buffer.alloc(0));
  const uploadedAt = partial.uploaded_at ?? minutesAgo(120);
  return {
    workspace_id: WORKSPACE_ID,
    mime_type: "text/markdown",
    byte_size: content.length,
    status: "completed",
    document_role: "EDITABLE",
    source_uri: `mock://documents/${partial.id}`,
    uploaded_at: uploadedAt,
    updated_at: uploadedAt,
    current_version: 1,
    edit_revision: 1,
    versions: [{ version: 1, content_hash: hash(content.toString("utf8")), created_by: USER_ID, created_at: uploadedAt, markdown }],
    ...partial,
    markdown,
    content
  };
}

function page(partial) {
  return { workspace_id: WORKSPACE_ID, status: "published", ...partial };
}

function edge(from, to, link_type, label = null) {
  return { workspace_id: WORKSPACE_ID, from_page_id: from, to_page_id: to, link_type, label, confidence: 0.9 };
}

export function seed() {
  state.users.push(
    { id: USER_ID, email: DEMO_EMAIL, password: DEMO_PASSWORD, display_name: "데모 사용자", provider: "email", created_at: minutesAgo(60 * 24 * 30), mfa: { enabled: false, activated_at: null, secret: null, recovery_codes: [] } },
    { id: MEMBER_ID, email: "jihyun@fruition.local", password: "member1234", display_name: "김지현", provider: "google", created_at: minutesAgo(60 * 24 * 20), mfa: { enabled: false, activated_at: null, secret: null, recovery_codes: [] } }
  );

  state.workspaces.push(
    { id: WORKSPACE_ID, name: "Fruition 팀 위키", icon_emoji: "🍇", icon_url: null, icon_image: null, owner_id: USER_ID, created_at: minutesAgo(60 * 24 * 30), updated_at: minutesAgo(60 * 24 * 2), ai_model_settings: { provider: "claude", model: "claude-sonnet-4-5" }, maintenance: { needs_lint: true, last_lint_at: minutesAgo(60 * 24), last_wiki_change_at: minutesAgo(90) } },
    { id: "ws_research", name: "논문 리서치", icon_emoji: "📚", icon_url: null, icon_image: null, owner_id: USER_ID, created_at: minutesAgo(60 * 24 * 10), updated_at: minutesAgo(60 * 24 * 10), ai_model_settings: { provider: "gemini", model: "gemini-2.5-pro" }, maintenance: { needs_lint: false, last_lint_at: null, last_wiki_change_at: null } }
  );
  state.members.push(
    { workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "OWNER", joined_at: minutesAgo(60 * 24 * 30) },
    { workspace_id: WORKSPACE_ID, user_id: MEMBER_ID, role: "MEMBER", joined_at: minutesAgo(60 * 24 * 15) },
    { workspace_id: "ws_research", user_id: USER_ID, role: "OWNER", joined_at: minutesAgo(60 * 24 * 10) }
  );

  state.documents.push(
    document({ id: "doc_intro", filename: "프로젝트 소개.md", markdown: INTRO_MD, processed_at: minutesAgo(100) }),
    document({ id: "doc_arch", filename: "아키텍처 개요.md", markdown: ARCH_MD, processed_at: minutesAgo(95), needs_reingest: true, updated_at: minutesAgo(30), current_version: 2, edit_revision: 2 }),
    document({ id: "doc_paper", filename: "지식 그래프 검색 논문.pdf", mime_type: "application/pdf", document_role: "ORIGINAL", content: buildPdf("Knowledge Graph Retrieval - Fruition mock PDF"), processed_at: minutesAgo(80) }),
    document({ id: "doc_paper_md", filename: "지식 그래프 검색 논문.md", markdown: PAPER_MD, processed_at: minutesAgo(78) }),
    document({ id: "doc_notes", filename: "회의 노트 초안.md", markdown: NOTES_MD, status: "processing", processing_state: "running", processing_stage: "concept_extraction", processing_started_at: minutesAgo(1), uploaded_at: minutesAgo(3) }),
    document({ id: "doc_failed", filename: "깨진 문서.md", markdown: "# 제목만 있는 문서\n", status: "failed", processing_state: "failed", error_message: "LLM 응답 파싱에 실패했습니다.", uploaded_at: minutesAgo(50) }),
    document({ id: "doc_todo", filename: "할 일.md", markdown: TODO_MD, status: "uploaded", uploaded_at: minutesAgo(5) }),
    document({ id: "doc_meeting", filename: "주간 회의.txt", mime_type: "text/plain", document_role: "ORIGINAL", content: Buffer.from(MEETING_TXT, "utf8"), status: "uploaded", uploaded_at: minutesAgo(4) })
  );

  state.wikiPages.push(
    page({ id: "page_src_intro", page_type: "source", title: "프로젝트 소개", slug: "project-intro", summary: "Fruition 서비스의 목적과 핵심 흐름을 정리한 문서.", source_document_id: "doc_intro", markdown: "# 프로젝트 소개\n\nFruition은 문서를 위키와 지식 그래프로 바꾼다. 핵심 흐름은 업로드 → [[Ingest]] → 질의다.\n" }),
    page({ id: "page_src_arch", page_type: "source", title: "아키텍처 개요", slug: "architecture", summary: "서비스 경계와 Ingest·Lint 파이프라인 설명.", source_document_id: "doc_arch", markdown: "# 아키텍처 개요\n\nAccess와 Document 서비스로 나뉘며, [[Ingest]]와 [[Lint]]는 AI 파이프라인이 담당한다.\n" }),
    page({ id: "page_src_paper", page_type: "source", title: "지식 그래프 검색 논문", slug: "kg-retrieval-paper", summary: "지식 그래프로 근거 문단을 선별하는 방법.", source_document_id: "doc_paper_md", markdown: "# 지식 그래프 검색 논문\n\n[[RAG 검색]]에서 그래프 탐색으로 근거를 고른다.\n" }),
    page({ id: "page_c_ingest", page_type: "concept", title: "Ingest", slug: "ingest", summary: "문서를 분석해 위키 페이지를 만드는 파이프라인 단계.", source_document_id: null, markdown: "# Ingest\n\n편집 가능한 Markdown을 입력으로 받아 source/concept 페이지를 생성한다. 완료 후 [[Lint]]가 필요할 수 있다.\n" }),
    page({ id: "page_c_lint", page_type: "concept", title: "Lint", slug: "lint", summary: "위키 페이지를 다듬고 중복 개념을 병합하는 유지보수 작업.", source_document_id: null, markdown: "# Lint\n\n마지막 실행 이후 변경된 페이지를 정리한다.\n" }),
    page({ id: "page_c_rag", page_type: "concept", title: "RAG 검색", slug: "rag-search", summary: "질문과 관련된 근거를 찾아 답변에 인용하는 검색 방식.", source_document_id: null, markdown: "# RAG 검색\n\n위키 그래프와 원문 블록을 함께 검색한다.\n" }),
    page({ id: "page_c_workspace", page_type: "concept", title: "워크스페이스", slug: "workspace", summary: "문서·위키·멤버를 묶는 협업 단위.", source_document_id: null, markdown: "# 워크스페이스\n\nOWNER와 MEMBER 역할이 있다.\n" })
  );
  state.wikiEdges.push(
    edge("page_src_intro", "page_c_ingest", "source_mentions_concept"),
    edge("page_src_intro", "page_c_workspace", "source_mentions_concept"),
    edge("page_src_arch", "page_c_ingest", "source_mentions_concept"),
    edge("page_src_arch", "page_c_lint", "source_mentions_concept"),
    edge("page_src_paper", "page_c_rag", "source_mentions_concept"),
    edge("page_c_ingest", "page_c_lint", "related", "후속 작업"),
    edge("page_c_rag", "page_c_ingest", "related", "입력 데이터")
  );

  state.chatSessions.push({ id: "chat_1", workspace_id: WORKSPACE_ID, title: "Ingest 흐름 질문", created_at: minutesAgo(60), last_message_at: minutesAgo(40) });
  state.chatMessages.push(
    { id: "msg_1", session_id: "chat_1", role: "user", content: "Ingest는 어떤 문서를 입력으로 받나요?", status: "completed", created_at: minutesAgo(45), pair_id: "pair_1", references: [] },
    { id: "msg_2", session_id: "chat_1", role: "assistant", content: "Ingest는 편집 가능한 Markdown 문서만 입력으로 받습니다[1]. PDF 같은 원본 문서는 먼저 Markdown 변환을 거쳐야 합니다[2].", status: "completed", created_at: minutesAgo(44), pair_id: "pair_1", run_id: "query_seed_1",
      related_pages: [{ wiki_page_id: "page_c_ingest", rank: 1, page_type: "concept", title: "Ingest", slug: "ingest", relevance_score: 0.92, role: "primary", depth: 0 }],
      references: [
        { id: 1, reference_type: "evidence", rank: 1, source_document_id: "doc_arch", source_block_ids: ["B0004"], text: "Ingest는 편집 가능한 Markdown만 입력으로 받습니다." },
        { id: 2, reference_type: "evidence", rank: 2, source_document_id: "doc_arch", source_block_ids: ["B0004"], text: "PDF 등 원본 문서는 먼저 Markdown 변환을 거칩니다." }
      ] }
  );

  state.operationLogs.push(
    { operation_id: "op_ingest_intro", workspace_id: WORKSPACE_ID, operation_type: "ingest", status: "succeeded", target_document_id: "doc_intro", target_display_name: "프로젝트 소개.md", summary: "source 1개, concept 2개 생성", changed_resource_count: 3, restored_from: null, created_at: minutesAgo(101), completed_at: minutesAgo(100),
      changes: [
        { id: 1, resource_type: "wiki_page", resource_id: "page_src_intro", resource_display_name: "프로젝트 소개", page_type: "source", before_revision: null, after_revision: 1, change_type: "created", change_summary: "source 페이지 생성", additions: 12, deletions: 0 },
        { id: 2, resource_type: "wiki_page", resource_id: "page_c_ingest", resource_display_name: "Ingest", page_type: "concept", before_revision: null, after_revision: 1, change_type: "created", change_summary: "concept 페이지 생성", additions: 6, deletions: 0 },
        { id: 3, resource_type: "wiki_page", resource_id: "page_c_workspace", resource_display_name: "워크스페이스", page_type: "concept", before_revision: null, after_revision: 1, change_type: "created", change_summary: "concept 페이지 생성", additions: 4, deletions: 0 }
      ] },
    { operation_id: "op_ingest_arch", workspace_id: WORKSPACE_ID, operation_type: "ingest", status: "succeeded", target_document_id: "doc_arch", target_display_name: "아키텍처 개요.md", summary: "source 1개, concept 1개 생성", changed_resource_count: 2, restored_from: null, created_at: minutesAgo(96), completed_at: minutesAgo(95),
      changes: [
        { id: 4, resource_type: "wiki_page", resource_id: "page_src_arch", resource_display_name: "아키텍처 개요", page_type: "source", before_revision: null, after_revision: 1, change_type: "created", change_summary: "source 페이지 생성", additions: 9, deletions: 0 },
        { id: 5, resource_type: "wiki_page", resource_id: "page_c_lint", resource_display_name: "Lint", page_type: "concept", before_revision: null, after_revision: 1, change_type: "created", change_summary: "concept 페이지 생성", additions: 5, deletions: 0 }
      ] },
    { operation_id: "op_edit_arch", workspace_id: WORKSPACE_ID, operation_type: "document_edit", status: "succeeded", target_document_id: "doc_arch", target_display_name: "아키텍처 개요.md", summary: "Lint 섹션 설명 보강", changed_resource_count: 1, restored_from: null, created_at: minutesAgo(31), completed_at: minutesAgo(30),
      changes: [{ id: 6, resource_type: "document", resource_id: "doc_arch", resource_display_name: "아키텍처 개요.md", before_revision: 1, after_revision: 2, change_type: "updated", change_summary: "Lint 설명 한 줄 추가", additions: 1, deletions: 1,
        hunks: [{ old_start: 11, old_lines: 1, new_start: 11, new_lines: 1, lines: [
          { type: "DELETE", old_line: 11, new_line: null, content: "Lint는 위키 페이지를 다듬습니다." },
          { type: "ADD", old_line: null, new_line: 11, content: "Lint는 마지막 실행 이후 바뀐 위키 페이지를 다듬고 중복 개념을 병합합니다." }
        ] }] }] },
    { operation_id: "op_lint_1", workspace_id: WORKSPACE_ID, operation_type: "lint", status: "succeeded", target_document_id: null, target_display_name: null, summary: "2개 페이지 다듬음", changed_resource_count: 2, restored_from: null, created_at: minutesAgo(60 * 24 + 5), completed_at: minutesAgo(60 * 24),
      changes: [
        { id: 7, resource_type: "wiki_page", resource_id: "page_c_ingest", resource_display_name: "Ingest", page_type: "concept", before_revision: 1, after_revision: 2, change_type: "updated", change_summary: "요약 문장 정리", additions: 2, deletions: 1 },
        { id: 8, resource_type: "wiki_page", resource_id: "page_c_rag", resource_display_name: "RAG 검색", page_type: "concept", before_revision: 1, after_revision: 2, change_type: "updated", change_summary: "링크 보정", additions: 1, deletions: 1 }
      ] },
    { operation_id: "op_ingest_failed", workspace_id: WORKSPACE_ID, operation_type: "ingest", status: "failed", target_document_id: "doc_failed", target_display_name: "깨진 문서.md", summary: "LLM 응답 파싱에 실패했습니다.", changed_resource_count: 0, restored_from: null, created_at: minutesAgo(49), completed_at: minutesAgo(48), changes: [] }
  );

  state.skills.push(
    { id: "skill_summarize", workspace_id: WORKSPACE_ID, owner_user_id: USER_ID, slug: "summarize", scope_type: "personal", status: "enabled",
      enabled_version: { id: "sv_1", name: "summarize", description: "선택한 문서를 3문단으로 요약한다.", status: "published", version: 1, allowed_tools: ["read_document"], capabilities: ["summarize"], instructions_markdown: "# summarize\n\n문서를 3문단 이내로 요약한다. 핵심 용어는 굵게 표시한다.\n" },
      latest_version: { id: "sv_1", name: "summarize", description: "선택한 문서를 3문단으로 요약한다.", status: "published", version: 1, allowed_tools: ["read_document"], capabilities: ["summarize"], instructions_markdown: "# summarize\n\n문서를 3문단 이내로 요약한다. 핵심 용어는 굵게 표시한다.\n" } },
    { id: "skill_meeting", workspace_id: WORKSPACE_ID, owner_user_id: MEMBER_ID, slug: "meeting-notes", scope_type: "workspace", status: "disabled",
      enabled_version: null,
      latest_version: { id: "sv_2", name: "meeting-notes", description: "회의록에서 결정 사항과 액션 아이템을 추출한다.", status: "published", version: 2, allowed_tools: ["read_document", "create_document"], capabilities: ["extract"], instructions_markdown: "# meeting-notes\n\n결정 사항, 액션 아이템, 담당자를 표로 정리한다.\n" } }
  );

  state.aiModels.push(
    { provider: "claude", model: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
    { provider: "claude", model: "claude-opus-4-1", display_name: "Claude Opus 4.1" },
    { provider: "gemini", model: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" },
    { provider: "gemini", model: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash" },
    { provider: "openai", model: "gpt-5", display_name: "ChatGPT (GPT-5)" }
  );

  state.invitations.push({ id: "inv_1", token: "mock-invite-token", workspace_id: WORKSPACE_ID, email: "newbie@fruition.local", role: "MEMBER", invited_by: DEMO_EMAIL, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(), created_at: now() });
}
