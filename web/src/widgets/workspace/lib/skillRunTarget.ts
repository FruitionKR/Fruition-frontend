import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { SkillVersion } from "@/entities/skill/model/skill";
import type { TreeItem } from "@/entities/tree/model/tree";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";

/**
 * 스킬이 실행에서 하는 일. capability·결과 방식(result_mode)으로 정한다.
 * - organize: 폴더 정리 / template: 템플릿으로 새 문서 / create: 새 문서로 만들기 / edit: 열린 문서 고치기 / auto: 상황에 맞게
 */
export type SkillRunIntent = "organize" | "template" | "create" | "edit" | "auto";

/**
 * 스킬 실행 대상의 종류(Figma 1567:25081 안내 문구).
 * - document: 고칠 Markdown 문서('열린 문서 고치기')
 * - folder: 폴더 정리 스킬은 정리할 폴더, 템플릿 스킬은 새 문서를 둘 폴더
 * - document-or-folder: '새 문서로 만들기'는 요약·변환할 문서나 새 문서를 둘 폴더, '상황에 맞게'는 고칠 문서나 새 문서를 둘 폴더
 */
export type SkillRunTargetKind = "document" | "folder" | "document-or-folder";

/** parentFolderId는 문서가 있는 폴더(루트면 null). 새 문서를 만드는 스킬이 새 문서를 그 옆에 둔다. */
export type SkillRunTarget =
  | { kind: "document"; itemId: string; documentId: string; parentFolderId: string | null; label: string }
  | { kind: "folder"; itemId: string; folderId: string; label: string };

/** 고른 항목을 대상으로 쓸 수 없을 때 안내. ignore는 폴더 펼치기처럼 고르기로 보지 않는 클릭이다. */
export type SkillRunTargetResolution =
  | { status: "ok"; target: SkillRunTarget }
  | { status: "invalid"; message: string }
  | { status: "ignore" };

type SkillVersionLike = Pick<SkillVersion, "capabilities" | "result_mode" | "targets"> | null | undefined;

export function skillRunIntent(version: SkillVersionLike): SkillRunIntent {
  const capabilities = version?.capabilities ?? [];
  if (capabilities.includes("folder-organize")) return "organize";
  if (capabilities.includes("template")) return "template";
  const resultMode = version?.result_mode;
  if (resultMode === "create" || resultMode === "edit" || resultMode === "auto") return resultMode;
  // result_mode가 없는 예전 버전은 capability로 판단한다.
  const canCreate = capabilities.includes("document-create");
  const canEdit = capabilities.includes("document-edit");
  if (canCreate && !canEdit) return "create";
  if (canEdit && !canCreate) return "edit";
  return "auto";
}

export function skillRunTargetKind(version: SkillVersionLike): SkillRunTargetKind {
  const intent = skillRunIntent(version);
  if (intent === "organize" || intent === "template") return "folder";
  if (intent === "edit") return "document";
  return "document-or-folder";
}

export function isFolderOrganizeSkill(version: SkillVersionLike): boolean {
  return skillRunIntent(version) === "organize";
}

/**
 * 사이드바에서 문서 전체를 고를 수 없는 스킬이면 안내 문구, 아니면 null.
 * 대상(targets)이 '선택한 부분'뿐인 문서 스킬은 문서에서 부분을 고른 채 채팅으로만 실행할 수 있다.
 * targets가 없거나 비어 있으면(예전 응답·기본값) 문서 전체를 받는 것으로 본다.
 */
export function skillRunBlockedMessage(version: SkillVersionLike, slug: string): string | null {
  const targets = version?.targets ?? [];
  const intent = skillRunIntent(version);
  if (intent === "organize" || intent === "template") return null;
  if (targets.length === 0 || targets.includes("current_document")) return null;
  return `이 스킬은 문서에서 선택한 부분에만 쓸 수 있어요. 문서에서 부분을 선택한 뒤 채팅에 /${slug}를 입력하세요.`;
}

function documentPickedMessage(intent: SkillRunIntent): string {
  return intent === "organize"
    ? "폴더 정리 스킬은 정리할 폴더를 골라 주세요."
    : "템플릿 스킬은 새 문서를 둘 폴더를 골라 주세요.";
}

/**
 * 사이드바에서 누른 항목이 이 스킬의 실행 대상이 될 수 있는지 판단한다.
 * parentFolderId는 트리에서 찾은 항목의 부모 폴더(루트면 null)다. 모르면(undefined) 문서 응답의 folder_id를 쓴다.
 */
export function resolveSkillRunTarget(
  version: SkillVersionLike,
  item: TreeItem,
  documents: readonly DocumentItemResponse[],
  slug: string,
  parentFolderId?: string | null
): SkillRunTargetResolution {
  const blocked = skillRunBlockedMessage(version, slug);
  if (blocked != null) return { status: "invalid", message: blocked };
  const intent = skillRunIntent(version);
  const kind = skillRunTargetKind(version);
  if (item.type === "wiki") return { status: "invalid", message: "위키 페이지가 아닌 문서나 폴더를 골라 주세요." };
  if (item.type === "folder") {
    // 문서만 받는 스킬에서 폴더를 누르면 펼치기만 한다.
    if (kind === "document") return { status: "ignore" };
    if (item.canEdit === false) return { status: "invalid", message: "편집 권한이 있는 폴더만 고를 수 있습니다." };
    return { status: "ok", target: { kind: "folder", itemId: item.id, folderId: item.id, label: item.label } };
  }
  if (!item.documentId) return { status: "ignore" };
  if (kind === "folder") return { status: "invalid", message: documentPickedMessage(intent) };
  if (item.canEdit === false) return { status: "invalid", message: "편집 권한이 있는 문서만 고를 수 있습니다." };
  const document = documents.find((entry) => entry.id === item.documentId);
  if (!document || !isMarkdownDocument(document)) {
    return { status: "invalid", message: "Markdown 문서만 스킬을 실행할 수 있습니다. 다른 문서를 골라 주세요." };
  }
  return {
    status: "ok",
    target: { kind: "document", itemId: item.id, documentId: document.id, parentFolderId: parentFolderId !== undefined ? parentFolderId : document.folder_id ?? null, label: item.label }
  };
}

/**
 * 작업 탭으로 보낼 스킬 실행 요청 문장. 커맨드(`/slug`)만 보낸다. 할 일 없이 `/slug`만 온 턴은 AI가 라우터를 거치지 않고
 * Skill 정의(결과 방식)와 고른 대상으로 실행한다(ai agent.md). 문장을 붙이면 라우터 판단이 끼어 '상황에 맞게'가 흔들린다.
 * 문서는 열린 문서(editor snapshot)로, 폴더는 folder_id로 따로 간다.
 */
export function skillRunMessage(slug: string): string {
  return `/${slug}`;
}

/**
 * 요청의 작업 대상 폴더(folder_id). 폴더 정리 범위이자 새 문서를 둘 위치다.
 * '새 문서로 만들기' 스킬에 문서를 고르면 새 문서를 그 문서 옆(같은 폴더, 루트면 null)에 둔다.
 * 그 밖의 문서 대상은 null이다.
 */
export function skillRunFolderId(version: SkillVersionLike, target: SkillRunTarget): string | null {
  if (target.kind === "folder") return target.folderId;
  return skillRunIntent(version) === "create" ? target.parentFolderId : null;
}
