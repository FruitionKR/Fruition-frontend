/**
 * 묶음 이동·삭제에서 항목을 건너뛴 이유. 판정 모듈(treeMoveRules·treeBulkSelection)과 테스트가 값으로 비교하므로 한국어 그대로 두고,
 * 화면에 보일 때 메시지 키(documents.tree.skipReason.*)로 옮긴다(useTreeReasonText).
 */
export const TREE_SKIP_REASONS = {
  generatedMove: "자동 생성 항목은 옮길 수 없습니다",
  generatedDelete: "자동 생성 항목은 삭제할 수 없습니다",
  uploadPending: "업로드가 끝나지 않았습니다",
  noEditPermission: "편집 권한이 없습니다",
  noDeletePermission: "삭제 권한이 없습니다",
  intoOwnSubtree: "자기 자신이나 하위 폴더 안으로 옮길 수 없습니다",
  duplicateName: "대상 폴더에 같은 이름의 항목이 있습니다"
} as const;

export type TreeSkipReasonKey = keyof typeof TREE_SKIP_REASONS;

/** 건너뛴 이유 문구의 메시지 키. 이 모듈의 문구가 아니면 null이다. */
export function treeSkipReasonKey(reason: string): TreeSkipReasonKey | null {
  const entry = Object.entries(TREE_SKIP_REASONS).find(([, value]) => value === reason);
  return entry ? (entry[0] as TreeSkipReasonKey) : null;
}
