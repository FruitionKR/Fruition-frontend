"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchDocumentTree } from "@/entities/tree/api/documentTree";
import { findServerTreeItem } from "@/entities/tree/model/serverTree";
import { fetchStorageUsage } from "@/entities/workspace/api/storage";
import { invalidateStorageUsage } from "@/entities/workspace";
import { getWorkspaceId } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import {
  completeImport,
  createImportSession,
  fetchImportIngestEstimate,
  importWriter,
  startImportIngest,
  type ImportIngestEstimate
} from "../api/imports";
import type { ImportPlan } from "../lib/notionPlan";
import { ZipSafetyError } from "../lib/zipArchive";
import { analyzeNotionZip } from "./analyzeNotionZip";
import { needsIngestConfirmation, runIngestLoop, type IngestProgress } from "./importIngest";
import { createRunState, importErrorMessage, runImport, summarizeRun, type ImportFailure, type ImportProgress, type RunState } from "./importRunner";

export type StorageQuota = { usedBytes: number; limitBytes: number | null };

export type NotionImportStep =
  | { kind: "idle" }
  | { kind: "analyzing"; fileName: string }
  | { kind: "error"; message: string }
  | { kind: "preview"; fileName: string; plan: ImportPlan; quota: StorageQuota | null }
  | { kind: "running"; plan: ImportPlan; progress: ImportProgress; isCancelling: boolean }
  | { kind: "review"; plan: ImportPlan; failures: ImportFailure[]; fatalMessage: string | null; cancelled: boolean }
  | {
    kind: "summary";
    plan: ImportPlan;
    /** 만든 문서 수(표 포함). 편입 대상 수의 기본값 */
    createdCount: number;
    createdPages: number;
    createdTables: number;
    createdPdfs: number;
    /** 변환을 요청한 PDF 수. 변환이 끝날 때까지 트리에 '변환 중'으로 보이고 편입 대상에서 빠진다. */
    convertingPdfs: number;
    failedCount: number;
    cancelled: boolean;
    estimate: ImportIngestEstimate | null;
    estimateError: string | null;
    /**
     * idle: 편입할지 묻는 중, confirm: 큰 비용을 한 번 더 확인, running: 20개씩 요청 중,
     * stopped: 오류·AI 한도로 멈춤(다시 시도 가능), done: 모두 대기열에 넣음, skipped: 편입하지 않음
     */
    ingest: "idle" | "confirm" | "running" | "stopped" | "done" | "skipped";
    ingestProgress: IngestProgress | null;
    ingestError: string | null;
  };

/** 미리보기에서 시작을 막는 이유. 없으면 null */
export function previewBlocker(plan: ImportPlan, quota: StorageQuota | null): string | null {
  if (plan.documents.length === 0 && plan.pdfs.length === 0) return "가져올 Notion 페이지나 데이터베이스가 없어요.";
  if (quota?.limitBytes != null && quota.usedBytes + plan.totalBytes > quota.limitBytes) return "저장 공간이 부족해 가져올 수 없어요. 사용하지 않는 문서를 삭제한 뒤 다시 시도해 주세요.";
  return null;
}

/** 대상 폴더에 이미 있는 이름. 가져오는 최상위 항목이 같은 이름이면 ` (2)`를 붙인다. */
async function existingNames(folderId: string | null) {
  const tree = await fetchDocumentTree();
  const siblings = folderId ? findServerTreeItem(tree.items, folderId)?.children ?? [] : tree.items;
  return {
    folders: siblings.filter((item) => item.type === "folder").map((item) => item.name),
    documents: siblings.filter((item) => item.type === "document").map((item) => item.name.replace(/\.md$/i, ""))
  };
}

export function useNotionImport({ refreshBackendData }: { refreshBackendData: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetFolderRef = useRef<string | null>(null);
  const [step, setStep] = useState<NotionImportStep>({ kind: "idle" });
  const sessionRef = useRef<{ importId: string; workspaceId: string; state: RunState; completed: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** 가져올 폴더(null이면 최상위)를 정하고 zip 선택 창을 연다. */
  function openPicker(folderId: string | null) {
    targetFolderRef.current = folderId;
    inputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setStep({ kind: "error", message: "Notion에서 'Markdown & CSV'로 내보낸 zip 파일을 골라 주세요." });
      return;
    }
    setStep({ kind: "analyzing", fileName: file.name });
    try {
      const workspaceId = getWorkspaceId();
      const [bytes, names, quota] = await Promise.all([
        file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        existingNames(targetFolderRef.current),
        fetchStorageUsage(workspaceId).then((usage) => ({ usedBytes: usage.used_bytes, limitBytes: usage.limit_bytes })).catch(() => null)
      ]);
      const plan = await analyzeNotionZip(bytes, names);
      setStep({ kind: "preview", fileName: file.name, plan, quota });
    } catch (error) {
      const message = error instanceof ZipSafetyError ? error.message : getErrorMessage(error, "zip 파일을 읽지 못했어요.");
      setStep({ kind: "error", message });
    }
  }

  async function execute(plan: ImportPlan) {
    const session = sessionRef.current;
    // complete 뒤에는 이 세션으로 쓰면 서버가 IMPORT_INVALID로 거절한다. 다시 보내지 않는다.
    if (!session || session.completed) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStep({ kind: "running", plan, progress: { done: 0, total: 1, phase: "folders" }, isCancelling: false });
    const result = await runImport(plan, {
      importId: session.importId,
      writer: importWriter(session.importId, session.workspaceId, controller.signal),
      state: session.state,
      signal: controller.signal,
      onProgress: (progress) => setStep((current) => current.kind === "running" ? { ...current, progress } : current)
    }).catch((error: unknown) => ({ fatalMessage: getErrorMessage(error, "가져오기 중 오류가 났어요."), cancelled: false }));
    abortRef.current = null;
    void refreshBackendData().catch(() => {});
    invalidateStorageUsage(queryClient);
    const failures = [...session.state.failures.values()];
    if (result.cancelled || failures.length === 0) {
      await finish(plan, result.cancelled);
      return;
    }
    setStep({ kind: "review", plan, failures, fatalMessage: result.fatalMessage, cancelled: false });
  }

  async function start() {
    if (step.kind !== "preview") return;
    const { plan } = step;
    try {
      const workspaceId = getWorkspaceId();
      const session = await createImportSession(plan.itemCount, plan.totalBytes, workspaceId);
      sessionRef.current = { importId: session.import_id, workspaceId, state: createRunState(), completed: false };
    } catch (error) {
      setStep({ kind: "error", message: importErrorMessage(error, "가져오기를 시작하지 못했어요.") });
      return;
    }
    await execute(plan);
  }

  /** complete를 보내고 위키 편입 비용을 받아 요약 화면으로 간다. */
  async function finish(plan: ImportPlan, cancelled: boolean) {
    const session = sessionRef.current;
    if (!session) return;
    const counts = summarizeRun(plan, session.state);
    let estimate: ImportIngestEstimate | null = null;
    let estimateError: string | null = null;
    try {
      if (!session.completed) {
        await completeImport(session.importId, { created: counts.created, failed: counts.failed, skipped: counts.skipped }, session.workspaceId);
        session.completed = true;
      }
      if (counts.created > 0) estimate = await fetchImportIngestEstimate(session.importId, session.workspaceId);
    } catch (error) {
      estimateError = importErrorMessage(error, "위키 편입 비용을 계산하지 못했어요.");
    }
    setStep({ kind: "summary", plan, createdCount: counts.created, createdPages: counts.createdPages, createdTables: counts.createdTables, createdPdfs: counts.createdPdfs, convertingPdfs: counts.convertingPdfs, failedCount: counts.failed, cancelled, estimate, estimateError, ingest: counts.created > 0 ? "idle" : "skipped", ingestProgress: null, ingestError: null });
  }

  function cancel() {
    if (step.kind !== "running") return;
    setStep({ ...step, isCancelling: true });
    abortRef.current?.abort();
  }

  /** 편입 버튼. 예상 비용이 크면 먼저 확인 단계로 간다(확인에서 confirmed=true로 다시 부른다). */
  async function ingest(confirmed = false) {
    const session = sessionRef.current;
    if (step.kind !== "summary" || !session) return;
    if (!confirmed && step.ingest === "idle" && needsIngestConfirmation(step.estimate)) {
      setStep({ ...step, ingest: "confirm" });
      return;
    }
    // 멈춘 뒤 다시 시도하면 서버가 아직 편입하지 않은 문서부터 이어서 넣는다.
    const alreadyQueued = step.ingestProgress?.queued ?? 0;
    const total = Math.max(0, (step.estimate?.document_count ?? step.createdCount) - alreadyQueued);
    const update = (patch: Partial<Extract<NotionImportStep, { kind: "summary" }>>) =>
      setStep((current) => current.kind === "summary" ? { ...current, ...patch } : current);
    update({ ingest: "running", ingestError: null, ingestProgress: { queued: alreadyQueued, total: alreadyQueued + total } });
    const result = await runIngestLoop(() => startImportIngest(session.importId, session.workspaceId), {
      total,
      onProgress: (progress) => update({ ingestProgress: { queued: alreadyQueued + progress.queued, total: alreadyQueued + progress.total } })
    });
    void refreshBackendData().catch(() => {});
    if (result.status === "done") {
      update({ ingest: "done" });
      return;
    }
    const queuedSoFar = alreadyQueued + result.queued;
    const message = result.status === "limited"
      ? `${result.message} 지금까지 ${queuedSoFar.toLocaleString()}개를 편입 대기열에 넣었어요. 나머지는 나중에 다시 시도할 수 있어요.`
      : result.message;
    update({ ingest: "stopped", ingestError: message });
  }

  function close() {
    if (step.kind === "running" || step.kind === "analyzing" || (step.kind === "summary" && step.ingest === "running")) return;
    sessionRef.current = null;
    setStep({ kind: "idle" });
  }

  return {
    inputRef,
    step,
    openPicker,
    handleFileChange,
    start,
    cancel,
    retry: () => { if (step.kind === "review") void execute(step.plan); },
    finishWithFailures: () => { if (step.kind === "review") void finish(step.plan, false); },
    ingest: () => void ingest(false),
    confirmIngest: () => void ingest(true),
    cancelIngestConfirm: () => setStep((current) => current.kind === "summary" && current.ingest === "confirm" ? { ...current, ingest: "idle" } : current),
    skipIngest: () => setStep((current) => current.kind === "summary" ? { ...current, ingest: "skipped" } : current),
    close
  };
}

export type NotionImportController = ReturnType<typeof useNotionImport>;
