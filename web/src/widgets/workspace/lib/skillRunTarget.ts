import type { DocumentItemResponse } from "@/entities/document/model/document";
import type { SkillVersion } from "@/entities/skill/model/skill";
import type { Project, TreeItem } from "@/entities/tree/model/tree";
import { isMarkdownDocument } from "@/entities/document/lib/documentKind";

/**
 * 스킬 실행 대상의 종류(Figma 1567:25081 안내 문구).
 * - document: 고칠 Markdown 문서(결과 방식 '현재 문서 수정')
 * - folder: 폴더 정리 스킬은 정리할 폴더, 새 문서를 만드는 스킬(결과 방식 '새 문서'·템플릿)은 새 문서를 둘 폴더
 * - document-or-folder: '상황에 맞게'는 고칠 문서나 새 문서를 둘 폴더 둘 다 받는다
 */
export type SkillRunTargetKind = "document" | "folder" | "document-or-folder";

export type SkillRunTarget =
  | { kind: "document"; itemId: string; documentId: string; label: string }
  | { kind: "folder"; itemId: string; folderId: string; label: string };

/** 고른 항목을 대상으로 쓸 수 없을 때 안내. ignore는 폴더 펼치기처럼 고르기로 보지 않는 클릭이다. */
export type SkillRunTargetResolution =
  | { status: "ok"; target: SkillRunTarget }
  | { status: "invalid"; message: string }
  | { status: "ignore" };

type SkillVersionLike = Pick<SkillVersion, "capabilities" | "result_mode"> | null | undefined;

export function skillRunTargetKind(version: SkillVersionLike): SkillRunTargetKind {
  const capabilities = version?.capabilities ?? [];
  if (capabilities.includes("folder-organize") || capabilities.includes("template")) return "folder";
  const resultMode = version?.result_mode;
  if (resultMode === "create") return "folder";
  if (resultMode === "edit") return "document";
  const canCreate = capabilities.includes("document-create");
  const canEdit = capabilities.includes("document-edit");
  if (canCreate && !canEdit) return "folder";
  if (canEdit && !canCreate) return "document";
  return "document-or-folder";
}

export function isFolderOrganizeSkill(version: SkillVersionLike): boolean {
  return version?.capabilities.includes("folder-organize") ?? false;
}

function folderMessage(version: SkillVersionLike): string {
  return isFolderOrganizeSkill(version)
    ? "폴더 정리 스킬은 정리할 폴더를 골라 주세요."
    : "이 스킬은 새 문서를 만듭니다. 새 문서를 둘 폴더를 골라 주세요.";
}

/** 사이드바에서 누른 항목이 이 스킬의 실행 대상이 될 수 있는지 판단한다. */
export function resolveSkillRunTarget(
  version: SkillVersionLike,
  item: TreeItem,
  documents: readonly DocumentItemResponse[]
): SkillRunTargetResolution {
  const kind = skillRunTargetKind(version);
  if (item.type === "wiki") return { status: "invalid", message: "위키 페이지가 아닌 문서나 폴더를 골라 주세요." };
  if (item.type === "folder") {
    // 문서만 받는 스킬에서 폴더를 누르면 펼치기만 한다.
    if (kind === "document") return { status: "ignore" };
    if (item.canEdit === false) return { status: "invalid", message: "편집 권한이 있는 폴더만 고를 수 있습니다." };
    return { status: "ok", target: { kind: "folder", itemId: item.id, folderId: item.id, label: item.label } };
  }
  if (!item.documentId) return { status: "ignore" };
  if (kind === "folder") return { status: "invalid", message: folderMessage(version) };
  if (item.canEdit === false) return { status: "invalid", message: "편집 권한이 있는 문서만 고칠 수 있습니다." };
  const document = documents.find((entry) => entry.id === item.documentId);
  if (!document || !isMarkdownDocument(document)) {
    return { status: "invalid", message: "Markdown 문서만 스킬을 실행할 수 있습니다. 다른 문서를 골라 주세요." };
  }
  return { status: "ok", target: { kind: "document", itemId: item.id, documentId: document.id, label: item.label } };
}

/** 폴더 경로("상위 / 하위"). 이름이 같은 폴더를 에이전트가 구분할 수 있게 요청에 넣는다. */
export function treeItemPath(projects: readonly Project[], itemId: string): string | null {
  function walk(items: readonly TreeItem[], trail: string[]): string[] | null {
    for (const item of items) {
      const next = [...trail, item.label];
      if (item.id === itemId) return next;
      const found = item.children ? walk(item.children, next) : null;
      if (found) return found;
    }
    return null;
  }
  for (const project of projects) {
    const path = walk(project.items, []);
    if (path) return path.join(" / ");
  }
  return null;
}

/**
 * 작업 탭으로 보낼 스킬 실행 요청. 문서 대상은 열린 문서(editor snapshot)로 함께 가므로 커맨드만 보낸다.
 * 폴더 대상은 agent turn에 폴더 필드가 없어 요청 문장에 폴더 경로를 적는다.
 */
export function skillRunMessage(slug: string, version: SkillVersionLike, target: SkillRunTarget, folderPath: string | null): string {
  if (target.kind === "document") return `/${slug}`;
  const path = folderPath ?? target.label;
  return isFolderOrganizeSkill(version)
    ? `/${slug} 정리할 폴더: ${path}`
    : `/${slug} 새 문서를 둘 폴더: ${path}`;
}
