import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isPdfDocument } from "@/entities/document/lib/documentKind";
import { isGraphIngestEligible } from "@/features/wiki-ingest/model/graphDocuments";
import { getWikiReflectLabel, getWikiReflectState, WIKI_REFLECT_LABEL_KEYS } from "@/features/wiki-ingest/model/wikiReflectState";
import type koWiki from "@/shared/i18n/messages/ko/wiki.json";
import type { MessageTranslate } from "@/shared/i18n/messageTranslate";

type ReflectTranslate = MessageTranslate<typeof koWiki.reflect>;

export type TreeWikiReflectTone = "new" | "changed" | "retry";

/** 문서 트리 행 우측에 붙이는 위키 반영 배지 */
export type TreeWikiReflectBadge = {
  label: string;
  tone: TreeWikiReflectTone;
  /** title·aria-label로 읽히는 배지 의미 */
  description: string;
};

const BADGE_TONES: Record<string, { tone: TreeWikiReflectTone; description: string }> = {
  "not-included": { tone: "new", description: "위키에 아직 편입하지 않은 문서" },
  changed: { tone: "changed", description: "위키 편입 후 수정된 문서" },
  retry: { tone: "retry", description: "위키 편입에 실패한 문서" }
};

/**
 * 문서 하나의 트리 배지. 지금 위키 편입을 시작할 수 있는 문서에만 붙인다.
 * 채팅 편입 문서([채팅])도 그래프에서 편입할 수 있어 같은 규칙으로 붙인다.
 * PDF 원본·Markdown이 아닌 파일·변환 중이거나 변환에 실패한 노트·진행 중·최신 반영 문서는 null이다.
 * t(`useTranslations("wiki.reflect")`)를 넘기면 라벨·설명을 지금 언어로 쓴다.
 */
export function getTreeWikiReflectBadge(
  document: DocumentItemResponse,
  documents: DocumentItemResponse[],
  t?: ReflectTranslate
): TreeWikiReflectBadge | null {
  if (isPdfDocument(document)) return null;
  if (!isGraphIngestEligible(document, documents)) return null;
  const state = getWikiReflectState(document);
  const label = getWikiReflectLabel(document, t && ((key) => t(`label.${key}`)));
  const tone = BADGE_TONES[state];
  if (!label || !tone) return null;
  const key = WIKI_REFLECT_LABEL_KEYS[state as keyof typeof WIKI_REFLECT_LABEL_KEYS];
  return { label, tone: tone.tone, description: t ? t(`description.${key}`) : tone.description };
}

/** 문서 id별 트리 배지. 배지가 없는 문서는 넣지 않는다. */
export function buildTreeWikiReflectBadges(
  documents: DocumentItemResponse[],
  t?: ReflectTranslate
): ReadonlyMap<string, TreeWikiReflectBadge> {
  return new Map(documents.flatMap((document) => {
    const badge = getTreeWikiReflectBadge(document, documents, t);
    return badge ? [[document.id, badge] as const] : [];
  }));
}
