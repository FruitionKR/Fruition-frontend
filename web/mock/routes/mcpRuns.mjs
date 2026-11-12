// MCP 클라이언트가 제안한 문서 작업 승인 화면 확인용 run. 실행·조회 라우트는 agent.mjs가 그대로 맡는다.
// 열기: /mcp/workspaces/ws_fruition/runs/run_mcp_edit_demo (run_mcp_done_demo)
import { state } from "../state.mjs";

const PRICE = { unit_price_minor: 10, plan_cap_minor: 50, currency: "KRW", price_version: "mcp-docs-v1", maximum_charge_minor: 10 };
const AUTHORITY = { origin: "MCP_CLIENT", grant_id: "grant_demo", client_id: "https://claude.ai/oauth/claude-code-client-metadata", policy_generation: 1 };

function editOperation(status) {
  return {
    id: "opr_mcp_edit_1", sequence: 1, tool_name: "apply_document_edit", target_type: "document", target_id: "doc_arch", base_version: 2, depends_on: [],
    source_parent_id: null, destination_parent_id: null, status, error_code: null, warning: null, suggested_selected: true,
    arguments: { document_id: "doc_arch", base_version: 2, target: { type: "whole_document", start_line: 1, end_line: 1 }, content_artifact_id: "artifact_mcp_demo", content_hash: `sha256:${"a".repeat(64)}` },
    reason: "Ingest 설명의 오래된 표현을 최신 파이프라인에 맞게 고칩니다."
  };
}

function editPreview() {
  const lines = [
    { type: "context", text: "## Ingest" },
    { type: "delete", text: "Ingest는 업로드한 원본 파일을 그대로 입력으로 받습니다." },
    { type: "insert", text: "Ingest는 편집 가능한 Markdown만 입력으로 받습니다." },
    { type: "context", text: "PDF 등 원본 문서는 먼저 Markdown 변환을 거칩니다." }
  ];
  return {
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    items: [{
      operation_id: "opr_mcp_edit_1", document_id: "doc_arch", display_name: "아키텍처 개요.md", base_version: 2,
      summary: "Ingest 입력 설명을 최신 내용으로 고쳐요.", added_lines: 1, removed_lines: 1, hunks: [{ before_start: 1, after_start: 1, lines }]
    }],
    failure_status: null
  };
}

function mcpRun(runId, status, operationStatus, settlement) {
  return {
    id: runId, workspace_id: "ws_fruition", turn_id: null, status, error_code: null, request_summary: "아키텍처 개요 문서 수정", target_folder_id: null, rule_summary: null,
    plan: { id: `plan_${runId}`, version: 1, operation_hash: "b".repeat(64), summary: "아키텍처 개요 문서의 Ingest 설명을 고칩니다.", status, operations: [editOperation(operationStatus)] },
    ...AUTHORITY,
    mcp_approval_quote: { client_name: "Claude Code", selected_operation_count: 1, price_snapshot: PRICE },
    mcp_settlement: settlement,
    edit_previews: editPreview()
  };
}

export function seedMcpRuns() {
  state.agentRuns.set("run_mcp_edit_demo", mcpRun("run_mcp_edit_demo", "awaiting_approval", "planned", null));
  state.agentRuns.set("run_mcp_done_demo", mcpRun("run_mcp_done_demo", "completed", "succeeded", {
    approval_id: "approval_demo", execution_status: "FORWARDED", forward_status: "ACCEPTED", settlement_status: "SETTLED",
    charged_minor: 10, maximum_charge_minor: 10, currency: "KRW", client_name: "Claude Code", price_snapshot: PRICE
  }));
}
