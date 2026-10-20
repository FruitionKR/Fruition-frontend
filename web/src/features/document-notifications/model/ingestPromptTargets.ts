// 위키 편입 제안 카드가 다룰 문서를 최신 문서 목록에서 고른다. 카드는 발행 뒤에도 문서가 바뀌므로
// 표시할 때와 버튼을 누를 때마다 다시 고른다(삭제된 문서·이미 편입 중이거나 끝난 문서를 빼고, 바뀐 이름을 반영).

import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isWikiReflectEligible } from "@/features/wiki-ingest/model/wikiReflectState";

/** ids 중 아직 목록에 있고 지금 편입을 시작할 수 있는 문서(PDF 원본·진행 중·최신 반영 문서 제외). ids 순서를 지킨다. */
export function selectIngestPromptTargets(
  ids: readonly string[],
  documents: readonly DocumentItemResponse[]
): DocumentItemResponse[] {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return ids.flatMap((id) => {
    const document = byId.get(id);
    return document && isWikiReflectEligible(document) ? [document] : [];
  });
}

export function ingestPromptMessage(documents: readonly Pick<DocumentItemResponse, "filename">[]): string {
  return documents.length === 1
    ? `"${documents[0].filename}" 문서의 위키 편입을 시작해 보세요.`
    : `${documents.length}개 문서의 위키 편입을 시작해 보세요.`;
}

/**
 * 한 번이라도 위키에 편입된 적이 있는 문서인지. 재편입 제안("마지막 위키 편입 이후 수정됨")은 이런 문서에만 띄운다.
 * 편입 전 문서는 uploaded이고, PDF 변환만 끝난 문서는 completed여도 `convert:` run이라 편입 전이다.
 * 서버는 편입한 적 없는 새 노트에도 needs_reingest=true를 줄 수 있어 이 조건으로 거른다.
 */
export function hasBeenIngestedToWiki(document: Pick<DocumentItemResponse, "status" | "pipeline_run_id">): boolean {
  if (document.status === "uploaded") return false;
  return !document.pipeline_run_id?.startsWith("convert:");
}
