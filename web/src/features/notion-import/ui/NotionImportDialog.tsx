"use client";

import { formatBytes } from "@/entities/workspace/model/storageUsage";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { previewBlocker, type NotionImportController, type NotionImportStep } from "../model/useNotionImport";
import type { ImportPlan } from "../lib/notionPlan";
import styles from "./NotionImportDialog.module.css";

const TITLE_ID = "notion-import-title";
/** 미리보기에서 펼쳐 보여 줄 건너뛰는 항목 수. 나머지는 개수만 알린다. */
const SKIPPED_PREVIEW_LIMIT = 30;

/** 숨은 zip 선택 칸과 가져오기 대화상자. 화면에 항상 붙여 두고 openPicker로 연다. */
export function NotionImportHost({ controller }: { controller: NotionImportController }) {
  const { step } = controller;
  return (
    <>
      <input
        ref={controller.inputRef}
        className={styles.picker}
        type="file"
        accept=".zip,application/zip"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void controller.handleFileChange(event)}
      />
      {step.kind !== "idle" && (
        <CenteredModal ariaLabel="Notion에서 가져오기" className={styles.dialog} overlayClassName={styles.overlay} onClose={controller.close}>
          <h2 id={TITLE_ID} className={styles.title}>Notion에서 가져오기</h2>
          <StepBody step={step} controller={controller} />
        </CenteredModal>
      )}
    </>
  );
}

function StepBody({ step, controller }: { step: NotionImportStep; controller: NotionImportController }) {
  switch (step.kind) {
    case "idle":
      return null;
    case "analyzing":
      return <p className={styles.status} role="status">‘{step.fileName}’을 살펴보는 중이에요. 서버에는 아직 아무것도 올리지 않았어요.</p>;
    case "error":
      return (
        <>
          <p className={styles.error} role="alert">{step.message}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={controller.close}>닫기</button>
          </div>
        </>
      );
    case "preview":
      return <Preview step={step} controller={controller} />;
    case "running":
      return <Running step={step} controller={controller} />;
    case "review":
      return (
        <>
          <p className={step.fatalMessage ? styles.error : styles.status} role="alert">
            {step.fatalMessage ?? `${step.failures.length}개 항목을 가져오지 못했어요. 다시 시도하면 실패한 항목만 다시 보내요.`}
          </p>
          <ul className={styles.failures} aria-label="가져오지 못한 항목">
            {step.failures.map((failure) => (
              <li key={failure.key}><strong>{failure.label}</strong><span>{failure.message}</span></li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={controller.finishWithFailures}>이대로 마치기</button>
            <button type="button" className={styles.primary} onClick={controller.retry}>실패한 항목 다시 시도</button>
          </div>
        </>
      );
    case "summary":
      return <Summary step={step} controller={controller} />;
  }
}

function PlanCounts({ plan }: { plan: ImportPlan }) {
  const pages = plan.documents.length - plan.tableCount;
  return (
    <dl className={styles.counts}>
      <div><dt>폴더</dt><dd>{plan.folders.length.toLocaleString()}</dd></div>
      <div><dt>문서</dt><dd>{pages.toLocaleString()}</dd></div>
      <div><dt>표(데이터베이스)</dt><dd>{plan.tableCount.toLocaleString()}</dd></div>
      <div><dt>이미지</dt><dd>{plan.imageCount.toLocaleString()}</dd></div>
    </dl>
  );
}

function Preview({ step, controller }: { step: Extract<NotionImportStep, { kind: "preview" }>; controller: NotionImportController }) {
  const { plan, quota } = step;
  const blocker = previewBlocker(plan, quota);
  const skipped = plan.skipped.slice(0, SKIPPED_PREVIEW_LIMIT);
  return (
    <>
      <p className={styles.status}>‘{step.fileName}’에서 가져올 내용이에요. 확인한 뒤 시작해 주세요.</p>
      <PlanCounts plan={plan} />
      <p className={styles.meta}>
        올릴 크기 {formatBytes(plan.totalBytes)}
        {quota?.limitBytes != null && ` · 남은 저장 공간 ${formatBytes(Math.max(0, quota.limitBytes - quota.usedBytes))}`}
        {` · 문서와 이미지 ${plan.itemCount.toLocaleString()}개`}
      </p>
      <ul className={styles.notes}>
        {plan.skippedRowPages > 0 && <li>데이터베이스는 표 문서로만 가져와요. 행 페이지 {plan.skippedRowPages.toLocaleString()}개는 가져오지 않아요.</li>}
        {plan.brokenLinks.length > 0 && <li>zip 안에서 대상을 찾지 못한 링크 {plan.brokenLinks.length.toLocaleString()}개는 글자만 남겨요.</li>}
        <li>가져온 문서는 바로 위키에 편입하지 않아요. 가져오기가 끝나면 편입할지 고를 수 있어요.</li>
      </ul>
      {plan.skipped.length > 0 && (
        <details className={styles.skipped}>
          <summary>가져오지 않는 파일 {plan.skipped.length.toLocaleString()}개</summary>
          <ul>
            {skipped.map((item) => <li key={item.path}><span>{item.path}</span><small>{item.reason}</small></li>)}
            {plan.skipped.length > skipped.length && <li>외 {(plan.skipped.length - skipped.length).toLocaleString()}개</li>}
          </ul>
        </details>
      )}
      {blocker && <p className={styles.error} role="alert">{blocker}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={controller.close}>취소</button>
        <button type="button" className={styles.primary} disabled={Boolean(blocker)} onClick={() => void controller.start()}>가져오기 시작</button>
      </div>
    </>
  );
}

const PHASE_LABELS = { folders: "폴더 만드는 중", documents: "문서 만드는 중", content: "링크와 이미지 채우는 중" } as const;

function Running({ step, controller }: { step: Extract<NotionImportStep, { kind: "running" }>; controller: NotionImportController }) {
  const { done, total, phase } = step.progress;
  return (
    <>
      <div aria-live="polite" className={styles.status}>
        {step.isCancelling ? "멈추는 중이에요. 이미 보낸 요청이 끝나기를 기다려요." : `${PHASE_LABELS[phase]} · ${done.toLocaleString()} / ${total.toLocaleString()}`}
      </div>
      <progress className={styles.progress} max={total} value={done} aria-label="가져오기 진행률" />
      <PlanCounts plan={step.plan} />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={step.isCancelling} onClick={controller.cancel}>가져오기 멈추기</button>
      </div>
    </>
  );
}

function costLabel(estimate: { estimated_cost_usd: number | null; estimated_credits: number | null }): string {
  if (estimate.estimated_credits != null) return `예상 ${estimate.estimated_credits.toLocaleString()} 크레딧`;
  if (estimate.estimated_cost_usd != null) return `예상 비용 약 $${estimate.estimated_cost_usd.toFixed(2)}`;
  return "예상 비용을 아직 알 수 없어요";
}

function Summary({ step, controller }: { step: Extract<NotionImportStep, { kind: "summary" }>; controller: NotionImportController }) {
  const count = step.estimate?.document_count ?? step.createdCount;
  return (
    <>
      <p className={styles.status} role="status">
        {step.cancelled ? "가져오기를 멈췄어요. " : "가져오기를 마쳤어요. "}
        문서 {step.createdCount.toLocaleString()}개를 만들었어요{step.failedCount > 0 ? `(가져오지 못한 항목 ${step.failedCount.toLocaleString()}개)` : ""}.
      </p>
      {step.ingest === "queued" && <p className={styles.status} role="status">위키 편입을 시작했어요. 진행 상황은 위키 작업에서 볼 수 있어요.</p>}
      {step.ingest === "skipped" && step.createdCount > 0 && <p className={styles.meta}>위키 편입은 나중에 그래프 화면에서 문서를 골라 할 수 있어요.</p>}
      {(step.ingest === "idle" || step.ingest === "pending") && (
        <section className={styles.ingest} aria-labelledby="notion-import-ingest">
          <h3 id="notion-import-ingest">{count.toLocaleString()}개 문서를 위키에 편입할까요?</h3>
          <p className={styles.meta}>{step.estimate ? costLabel(step.estimate) : step.estimateError ?? "예상 비용을 아직 알 수 없어요"}</p>
          {step.ingestError && <p className={styles.error} role="alert">{step.ingestError}</p>}
        </section>
      )}
      <div className={styles.actions}>
        {(step.ingest === "idle" || step.ingest === "pending") ? (
          <>
            <button type="button" className={styles.secondary} disabled={step.ingest === "pending"} onClick={controller.skipIngest}>편입하지 않기</button>
            <button type="button" className={styles.primary} disabled={step.ingest === "pending"} aria-busy={step.ingest === "pending" || undefined} onClick={() => void controller.ingest()}>
              {count.toLocaleString()}개 문서를 위키에 편입
            </button>
          </>
        ) : (
          <button type="button" className={styles.primary} onClick={controller.close}>닫기</button>
        )}
      </div>
    </>
  );
}
