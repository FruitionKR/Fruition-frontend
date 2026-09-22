import { useCallback, useEffect, useRef, useState } from "react";
import { convertDocumentToMarkdown, reflectDocumentToWiki } from "@/entities/document";
import type { DocumentItemResponse } from "@/entities/document";
import { publishNotice } from "@/features/document-notifications";
import { getSelectedWorkspaceId } from "@/shared/lib/auth";
import { getErrorMessage } from "@/shared/lib/errors";
import { getWikiReflectState } from "./wikiReflectState";

type PendingIngest = { documentId: string; filename: string };

/** 확인한 PDF만 변환 완료 후 편입한다. 새로고침해도 같은 탭에서 이어서 처리한다. */
export function usePdfWikiIngest(documents: DocumentItemResponse[], refresh: () => Promise<void>) {
  const [pending, setPending] = useState<PendingIngest[]>([]);
  const pendingRef = useRef<PendingIngest[]>([]);
  const storageKeyRef = useRef<string | null>(null);
  const runningRef = useRef(new Set<string>());

  const updatePending = useCallback((update: (current: PendingIngest[]) => PendingIngest[]) => {
    const next = update(pendingRef.current);
    pendingRef.current = next;
    setPending(next);
    try {
      if (storageKeyRef.current) window.sessionStorage.setItem(storageKeyRef.current, JSON.stringify(next));
    } catch {
      // 저장소가 차단된 경우에도 현재 페이지에서는 이어서 편입한다.
    }
  }, []);

  useEffect(() => {
    const workspaceId = getSelectedWorkspaceId();
    if (!workspaceId) return;
    storageKeyRef.current = `fruition.pdf-wiki-ingest.${workspaceId}`;
    try {
      const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKeyRef.current) ?? "[]");
      if (!Array.isArray(stored)) return;
      const tasks = stored.filter((task): task is PendingIngest =>
        task !== null && typeof task === "object"
        && typeof task.documentId === "string" && typeof task.filename === "string"
      );
      pendingRef.current = tasks;
      setPending(tasks);
    } catch {
      // 유효한 대기 목록이 없으면 자동으로 새 작업을 만들지 않는다.
    }
  }, []);

  const startPdfIngest = useCallback(async (document: DocumentItemResponse) => {
    const converted = await convertDocumentToMarkdown(document.id, { openWhenReady: false });
    updatePending((current) => [
      ...current.filter((task) => task.documentId !== converted.id),
      { documentId: converted.id, filename: document.filename }
    ]);
  }, [updatePending]);

  useEffect(() => {
    for (const task of pending) {
      const document = documents.find((item) => item.id === task.documentId);
      if (!document || getWikiReflectState(document) === "processing" || runningRef.current.has(task.documentId)) continue;
      runningRef.current.add(task.documentId);
      void (async () => {
        try {
          if (document.status === "failed") {
            throw new Error(document.error_message || "PDF 변환에 실패하여 위키에 편입하지 못했습니다.");
          }
          // 편입 요청 직후 새로고침한 경우 서버에서 이미 완료된 작업을 다시 보내지 않는다.
          const alreadyIngested = document.status === "completed"
            && document.needs_reingest === false
            && document.pipeline_run_id && !document.pipeline_run_id.startsWith("convert:");
          if (!alreadyIngested) await reflectDocumentToWiki(document.id, "EDITABLE");
          publishNotice({ kind: "completed", title: "PDF 위키 편입 요청", message: `${task.filename}: Markdown 변환을 마치고 위키 편입을 요청했습니다.` });
        } catch (error) {
          publishNotice({ kind: "failed", title: "PDF 위키 편입 실패", message: `${task.filename}: ${getErrorMessage(error, "위키 편입에 실패했습니다.")}` });
        } finally {
          updatePending((current) => current.filter((item) => item.documentId !== task.documentId));
          runningRef.current.delete(task.documentId);
          await refresh().catch(() => {});
        }
      })();
    }
  }, [documents, pending, refresh, updatePending]);

  return { startPdfIngest, isPending: pending.length > 0 };
}
