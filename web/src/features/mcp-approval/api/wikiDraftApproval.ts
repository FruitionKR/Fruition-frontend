import { apiFetch, idempotentJsonHeaders, parseJsonOrThrow, workspacePath } from "@/shared/api/client";
import {
  mcpWikiApprovalBody,
  parseMcpWikiWebDraft,
  type McpWikiWebDraft
} from "../lib/wikiDraftPreview";

function path(workspaceId: string, draftId: string, action?: "approve" | "reject" | "cancel"): string {
  return workspacePath(workspaceId, "mcp", "wiki-drafts", draftId, ...(action ? [action] : []));
}

async function read(response: Response, expectedDraftId: string): Promise<McpWikiWebDraft> {
  const draft = parseMcpWikiWebDraft(await parseJsonOrThrow<unknown>(response, "위키 변경 상태를 확인하지 못했습니다."));
  if (draft.draft_id !== expectedDraftId) throw new Error("위키 변경 미리보기 응답 형식이 올바르지 않습니다.");
  return draft;
}

export async function fetchMcpWikiDraft(workspaceId: string, draftId: string, signal?: AbortSignal): Promise<McpWikiWebDraft> {
  return read(await apiFetch(path(workspaceId, draftId), { cache: "no-store", signal }), draftId);
}

export async function approveMcpWikiDraft(workspaceId: string, draft: McpWikiWebDraft): Promise<McpWikiWebDraft> {
  return read(await apiFetch(path(workspaceId, draft.draft_id, "approve"), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    body: JSON.stringify(mcpWikiApprovalBody(draft))
  }), draft.draft_id);
}

export async function rejectMcpWikiDraft(workspaceId: string, draftId: string): Promise<McpWikiWebDraft> {
  return read(await apiFetch(path(workspaceId, draftId, "reject"), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    body: "{}"
  }), draftId);
}

export async function cancelMcpWikiDraft(workspaceId: string, draftId: string): Promise<McpWikiWebDraft> {
  return read(await apiFetch(path(workspaceId, draftId, "cancel"), {
    method: "POST",
    headers: idempotentJsonHeaders(),
    body: "{}"
  }), draftId);
}
