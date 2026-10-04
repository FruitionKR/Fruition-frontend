import {
  apiFetch,
  ERROR_MESSAGES,
  getWorkspaceId,
  idempotencyKey,
  idempotentJsonHeaders,
  parseErrorResponse,
  workspacePath
} from "@/shared/api/client";
import type { SchemaFragments, SchemaIssue, SchemaStatus, WikiSchema, WikiSchemaPreview } from "@/entities/schema/model/schema";

// document-svc의 wiki-schema 프록시를 그대로 호출한다. 서버 JSON은 snake_case이므로 여기서만 camelCase로 옮긴다.
// 계약 원본: Fruition-document api-specs/openapi.yaml (WikiSchemaResponse / WikiSchemaPreviewResponse / WikiSchemaDraftRequest)
// 스키마 해석과 보안 분류(issues, has_blocked_issues)는 모두 서버 판정을 그대로 쓴다. 클라이언트는 다시 판정하지 않는다.

type FragmentsResponse = {
  global_markdown: string;
  query_markdown: string;
  ingest_markdown: string;
  edit_markdown: string;
  concept_markdown: string;
  template_markdown: string;
};

type IssueResponse = {
  severity: string;
  category: string;
  text: string;
  reason: string;
  section?: string | null;
};

type SchemaBodyResponse = {
  fragments: FragmentsResponse;
  issues: IssueResponse[];
  preview_markdown: string;
  has_blocked_issues: boolean;
};

type WikiSchemaResponse = SchemaBodyResponse & {
  id: string;
  name: string;
  raw_markdown: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  activated_at?: string | null;
};

type WikiSchemaDraftResponse = { wiki_schema: WikiSchemaResponse };

type WikiSchemaDraftListResponse = { wiki_schemas: WikiSchemaResponse[] };

const SCHEMA_STATUSES: readonly SchemaStatus[] = ["draft", "active", "rejected"];

function schemaBasePath(): string {
  return workspacePath(getWorkspaceId(), "wiki-schema");
}

// 문서화된 실패 응답만 고정 문구로 바꾼다. 서버·프로바이더 원문은 사용자에게 노출하지 않는다.
async function throwSchemaError(response: Response, fallback: string): Promise<never> {
  if (response.status === 400 || response.status === 422) throw new Error(ERROR_MESSAGES.schemaInvalid);
  if (response.status === 404) throw new Error(ERROR_MESSAGES.schemaNotFound);
  if (response.status === 503) throw new Error(ERROR_MESSAGES.schemaUnavailable);
  throw new Error(await parseErrorResponse(response, fallback));
}

function toFragments(response: FragmentsResponse): SchemaFragments {
  return {
    globalMarkdown: response.global_markdown,
    queryMarkdown: response.query_markdown,
    ingestMarkdown: response.ingest_markdown,
    editMarkdown: response.edit_markdown,
    conceptMarkdown: response.concept_markdown,
    templateMarkdown: response.template_markdown
  };
}

// severity는 서버 enum(blocked|unclear)이다. 모르는 값은 활성화를 막지 않는 경고로 낮춰 다룬다.
function toIssue(response: IssueResponse): SchemaIssue {
  return {
    severity: response.severity === "blocked" ? "blocked" : "unclear",
    category: response.category,
    text: response.text,
    reason: response.reason,
    section: response.section ?? null
  };
}

function toPreview(response: SchemaBodyResponse): WikiSchemaPreview {
  return {
    fragments: toFragments(response.fragments),
    issues: response.issues.map(toIssue),
    previewMarkdown: response.preview_markdown,
    hasBlockedIssues: response.has_blocked_issues
  };
}

function toSchema(response: WikiSchemaResponse): WikiSchema {
  const status = SCHEMA_STATUSES.find((candidate) => candidate === response.status) ?? "draft";
  return {
    id: response.id,
    name: response.name,
    rawMarkdown: response.raw_markdown,
    status,
    ...toPreview(response),
    createdAt: response.created_at ?? null,
    updatedAt: response.updated_at ?? null,
    activatedAt: response.activated_at ?? null
  };
}

/** 저장하지 않고 스킬 해석 결과만 받아온다. */
export async function previewWikiSchema(rawMarkdown: string): Promise<WikiSchemaPreview> {
  const response = await apiFetch(`${schemaBasePath()}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawMarkdown })
  });
  if (!response.ok) await throwSchemaError(response, ERROR_MESSAGES.schemaPreviewFailed);
  return toPreview(await response.json() as SchemaBodyResponse);
}

/** 검토할 스킬을 초안 상태로 저장한다. 이름을 비우면 서버가 붙인다. */
export async function createWikiSchemaDraft(rawMarkdown: string, name: string): Promise<WikiSchema> {
  const trimmedName = name.trim();
  const response = await apiFetch(`${schemaBasePath()}/drafts`, {
    method: "POST",
    headers: idempotentJsonHeaders(),
    body: JSON.stringify(trimmedName ? { rawMarkdown, name: trimmedName } : { rawMarkdown })
  });
  if (!response.ok) await throwSchemaError(response, ERROR_MESSAGES.schemaDraftFailed);
  return toSchema((await response.json() as WikiSchemaDraftResponse).wiki_schema);
}

/** 선택한 스킬을 활성화한다. 한 워크스페이스의 활성 스킬은 서버가 하나로 유지한다. */
export async function activateWikiSchema(id: string): Promise<WikiSchema> {
  const response = await apiFetch(`${schemaBasePath()}/${encodeURIComponent(id)}/activate`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() }
  });
  if (!response.ok) await throwSchemaError(response, ERROR_MESSAGES.schemaActivateFailed);
  return toSchema(await response.json() as WikiSchemaResponse);
}

/**
 * 초안 스킬 목록. 서버가 workspace와 인증 주체로 범위를 좁히므로 user_id는 보내지 않는다.
 * status가 draft인 행만 created_at 최신순으로 내려오고, 활성 스킬은 /active로 따로 조회한다.
 */
export async function fetchWikiSchemaDrafts(): Promise<WikiSchema[]> {
  const response = await apiFetch(`${schemaBasePath()}/drafts`, { cache: "no-store" });
  if (!response.ok) await throwSchemaError(response, ERROR_MESSAGES.schemaLoadFailed);
  const body = await response.json() as WikiSchemaDraftListResponse;
  return body.wiki_schemas.map(toSchema);
}

/** 활성 스킬 조회. 활성 스킬이 없으면 서버가 200으로 null을 주므로 null을 그대로 돌려준다. */
export async function fetchActiveWikiSchema(): Promise<WikiSchema | null> {
  const response = await apiFetch(`${schemaBasePath()}/active`, { cache: "no-store" });
  if (!response.ok) await throwSchemaError(response, ERROR_MESSAGES.schemaLoadFailed);
  const text = await response.text();
  if (!text.trim()) return null;
  const body = JSON.parse(text) as WikiSchemaResponse | null;
  return body ? toSchema(body) : null;
}
