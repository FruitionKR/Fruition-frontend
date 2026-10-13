import { useRef, useState } from "react";
import { fetchWikiMaintenanceStatus, publishNotice, requestWikiLint } from "@/features/document-notifications";
import { shouldRequestWikiLint, WIKI_UP_TO_DATE_NOTICE } from "@/features/document-notifications/model/wikiLintStatus";
import { isGraphIngestEligible } from "@/features/wiki-ingest/model/graphDocuments";
import type { usePdfWikiIngest } from "@/features/wiki-ingest/model/usePdfWikiIngest";
import { isPdfDocument } from "@/entities/document/lib/documentKind";
import { reflectDocumentToWiki, type DocumentItemResponse } from "@/entities/document";
import { getErrorMessage } from "@/shared/lib/errors";

/** 그래프 사이드바·채팅 안내의 위키 액션(편입 요청·Lint)과 PDF 변환 확인 모달 상태. */
export function useGraphWikiActions({
  documents,
  pdfWikiIngest,
  refreshBackendData
}: {
  documents: DocumentItemResponse[];
  pdfWikiIngest: ReturnType<typeof usePdfWikiIngest>;
  refreshBackendData: () => Promise<void>;
}) {
  const [wikiActionPending, setWikiActionPending] = useState<"ingest" | "lint" | null>(null);
  // 진행 중인 편입 요청의 대상 문서. 채팅 안내 버튼이 "이 노트"가 편입 중인지 구분하는 데 쓴다.
  const [ingestTargetIds, setIngestTargetIds] = useState<readonly string[]>([]);
  const [pdfIngestConfirmation, setPdfIngestConfirmation] = useState<DocumentItemResponse[] | null>(null);
  const graphIngestRunningRef = useRef(false);

  async function handleGraphIngest(targets: DocumentItemResponse[]) {
    if (graphIngestRunningRef.current || wikiActionPending || targets.length === 0) return;
    graphIngestRunningRef.current = true;
    setWikiActionPending("ingest");
    setIngestTargetIds(targets.map((target) => target.id));
    try {
      await sendGraphIngestRequests(targets);
    } finally {
      // 알림·재조회 단계에서 예외가 나도 버튼이 "위키 편입 중…"에 머물지 않게 한다.
      setWikiActionPending(null);
      setIngestTargetIds([]);
      graphIngestRunningRef.current = false;
    }
  }

  async function sendGraphIngestRequests(targets: DocumentItemResponse[]) {
    // 한 문서가 실패해도 나머지 문서의 요청은 계속 보낸다.
    const results = await Promise.allSettled(
      targets.map((target) => isPdfDocument(target)
        ? pdfWikiIngest.startPdfIngest(target)
        : reflectDocumentToWiki(target.id, target.document_role))
    );
    // 실패 사유는 백엔드 원문을 그대로 보여준다. 개수만 알려주면 원인을 알 수 없다.
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${targets[index].filename}: ${getErrorMessage(result.reason, "요청에 실패했습니다.")}`]
        : []
    );
    const startedCount = targets.length - failures.length;

    if (startedCount > 0) {
      await refreshBackendData().catch(() => {});
      publishNotice({
        kind: "completed",
        title: "위키 편입 요청",
        message: `${startedCount}개 문서 처리를 시작했습니다.`
      });
    }
    if (failures.length > 0) {
      publishNotice({
        kind: "failed",
        title: "위키 편입 실패",
        message: failures.join(" / ")
      });
    }
  }

  // 변환 전 PDF가 섞여 있으면 먼저 Markdown으로 변환한다는 확인을 받는다.
  function requestGraphIngest(targets: DocumentItemResponse[]) {
    if (targets.some(isPdfDocument)) {
      setPdfIngestConfirmation(targets);
      return;
    }
    void handleGraphIngest(targets);
  }

  function cancelPdfIngest() {
    setPdfIngestConfirmation(null);
  }

  function confirmPdfIngest() {
    if (!pdfIngestConfirmation) return;
    const selectedIds = new Set(pdfIngestConfirmation.map((document) => document.id));
    // 확인을 기다리는 동안 상태가 바뀐 문서(변환 시작·편입 진행 등)에는 중복 요청을 보내지 않는다.
    const targets = documents.filter((document) =>
      selectedIds.has(document.id) && isGraphIngestEligible(document, documents)
    );
    setPdfIngestConfirmation(null);
    void handleGraphIngest(targets);
  }

  async function handleGraphLint() {
    if (wikiActionPending) return;
    setWikiActionPending("lint");
    try {
      // 마지막 다듬기 이후 위키 변경이 있을 때만 실제 lint를 보낸다.
      const { needs_lint } = await fetchWikiMaintenanceStatus();
      if (!shouldRequestWikiLint(needs_lint)) {
        publishNotice({ kind: "info", ...WIKI_UP_TO_DATE_NOTICE });
        return;
      }
      const { changedPageCount, operationId } = await requestWikiLint(false);
      void refreshBackendData();
      publishNotice({
        operation: { type: "lint", id: operationId },
        kind: "completed",
        title: "Lint 완료",
        message: `${changedPageCount}개 페이지를 다듬었습니다.`
      });
    } catch (error: unknown) {
      publishNotice({
        kind: "failed",
        title: "Lint 실패",
        message: getErrorMessage(error, "Lint 요청에 실패했습니다.")
      });
    } finally {
      setWikiActionPending(null);
    }
  }

  return {
    wikiActionPending,
    ingestTargetIds,
    pdfIngestConfirmation,
    requestGraphIngest,
    cancelPdfIngest,
    confirmPdfIngest,
    handleGraphLint
  };
}
