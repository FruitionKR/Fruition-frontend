"use client";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

import { useFormatter, useTranslations } from "next-intl";
import { formatBytes } from "@/entities/workspace/model/storageUsage";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { previewBlocker, type NotionImportController, type NotionImportStep } from "../model/useNotionImport";
import type { ImportPlan } from "../lib/notionPlan";
import { convertEstimateOf, estimateLabel, formatKrw, maxEstimateLabel } from "../model/importIngest";
import styles from "./NotionImportDialog.module.css";

const TITLE_ID = "notion-import-title";
/** 미리보기에서 펼쳐 보여 줄 건너뛰는 항목 수. 나머지는 개수만 알린다. */
const SKIPPED_PREVIEW_LIMIT = 30;

/** 숨은 zip 선택 칸과 가져오기 대화상자. 화면에 항상 붙여 두고 openPicker로 연다. */
export function NotionImportHost({ controller }: { controller: NotionImportController }) {
  const t = useTranslations("notionImport");
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
        <CenteredModal ariaLabel={t("title")} className={styles.dialog} overlayClassName={styles.overlay} onClose={controller.close}>
          <h2 id={TITLE_ID} className={styles.title}>{t("title")}</h2>
          <StepBody step={step} controller={controller} />
        </CenteredModal>
      )}
    </>
  );
}

function StepBody({ step, controller }: { step: NotionImportStep; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  switch (step.kind) {
    case "idle":
      return null;
    case "analyzing":
      return <p className={styles.status} role="status">{t("analyzing", { fileName: step.fileName })}</p>;
    case "error":
      return (
        <>
          <p className={styles.error} role="alert">{step.message}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={controller.close}>{t("close")}</button>
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
            {step.fatalMessage ?? t("review.failedCount", { count: step.failures.length })}
          </p>
          <ul className={styles.failures} aria-label={t("review.failuresLabel")}>
            {step.failures.map((failure) => (
              <li key={failure.key}><strong>{failure.label}</strong><span>{failure.message}</span></li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={controller.finishWithFailures}>{t("review.finish")}</button>
            <button type="button" className={styles.primary} onClick={controller.retry}>{t("review.retry")}</button>
          </div>
        </>
      );
    case "summary":
      return <Summary step={step} controller={controller} />;
  }
}

function PlanCounts({ plan }: { plan: ImportPlan }) {
  const t = useTranslations("notionImport");
  const format = useFormatter();
  const pages = plan.documents.length - plan.tableCount - plan.rowPageCount;
  return (
    <dl className={styles.counts}>
      <div><dt>{t("counts.folders")}</dt><dd>{format.number(plan.folders.length)}</dd></div>
      <div><dt>{t("counts.documents")}</dt><dd>{format.number(pages)}</dd></div>
      <div><dt>{t("counts.tables")}</dt><dd>{format.number(plan.tableCount)}</dd></div>
      {plan.rowPageCount > 0 && <div><dt>{t("counts.rowPages")}</dt><dd>{format.number(plan.rowPageCount)}</dd></div>}
      <div><dt>{t("counts.images")}</dt><dd>{format.number(plan.imageCount)}</dd></div>
      {plan.pdfs.length > 0 && <div><dt>{t("counts.pdfs")}</dt><dd>{format.number(plan.pdfs.length)}</dd></div>}
    </dl>
  );
}

function Preview({ step, controller }: { step: Extract<NotionImportStep, { kind: "preview" }>; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  const { plan, quota } = step;
  const blocker = previewBlocker(plan, quota);
  const skipped = plan.skipped.slice(0, SKIPPED_PREVIEW_LIMIT);
  return (
    <>
      <p className={styles.status}>{t("preview.intro", { fileName: step.fileName })}</p>
      <PlanCounts plan={plan} />
      <p className={styles.meta}>
        {t("preview.uploadSize", { size: formatBytes(plan.totalBytes) })}
        {quota?.limitBytes != null && t("preview.remaining", { size: formatBytes(Math.max(0, quota.limitBytes - quota.usedBytes)) })}
        {plan.pdfs.length > 0 ? t("preview.itemsWithPdf", { count: plan.itemCount }) : t("preview.items", { count: plan.itemCount })}
      </p>
      <ul className={styles.notes}>
        {plan.rowPageCount > 0 && <li>{t("preview.rowPages", { count: plan.rowPageCount })}</li>}
        {plan.pdfs.length > 0 && <li>{t("preview.pdfs", { count: plan.pdfs.length })}</li>}
        {plan.folders.some((folder) => folder.pageDocumentKey) && <li>{t("preview.pageFolders")}</li>}
        {plan.notionLinkCount > 0 && <li>{t("preview.notionLinks", { count: plan.notionLinkCount })}</li>}
        {plan.brokenLinks.length > 0 && <li>{t("preview.brokenLinks", { count: plan.brokenLinks.length })}</li>}
        <li>{t("preview.noAutoIngest")}</li>
      </ul>
      {plan.skipped.length > 0 && (
        <details className={styles.skipped}>
          <summary>{t("preview.skipped", { count: plan.skipped.length })}</summary>
          <ul>
            {skipped.map((item) => <li key={item.path}><span>{item.path}</span><small>{t(`skipReasons.${item.reason}`)}</small></li>)}
            {plan.skipped.length > skipped.length && <li>{t("preview.skippedMore", { count: plan.skipped.length - skipped.length })}</li>}
          </ul>
        </details>
      )}
      {blocker && <p className={styles.error} role="alert">{t(`blocker.${blocker}`)}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={controller.close}>{t("cancel")}</button>
        <button type="button" className={styles.primary} disabled={Boolean(blocker)} onClick={() => void controller.start()}>{t("preview.start")}</button>
      </div>
    </>
  );
}

function Running({ step, controller }: { step: Extract<NotionImportStep, { kind: "running" }>; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  const { done, total, phase } = step.progress;
  return (
    <>
      <div aria-live="polite" className={styles.status}>
        {step.isCancelling ? t("running.cancelling") : t("running.progress", { phase: t(`running.phases.${phase}`), done, total })}
      </div>
      <progress className={styles.progress} max={total} value={done} aria-label={t("running.progressLabel")} />
      <PlanCounts plan={step.plan} />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={step.isCancelling} onClick={controller.cancel}>{t("running.stop")}</button>
      </div>
    </>
  );
}

type SummaryStep = Extract<NotionImportStep, { kind: "summary" }>;

function Summary({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  // PDF 변환을 먼저 묻는다(변환이 편입의 전제). 정하고 나면 편입을 묻는다.
  const isConverting = step.convert === "idle" || step.convert === "confirm" || step.convert === "running" || step.convert === "stopped";
  const converting = step.estimate?.converting_count ?? 0;
  const unconverted = step.convert === "skipped" ? step.estimate?.pdf_unconverted_count ?? 0 : 0;
  return (
    <>
      <p className={styles.status} role="status">
        {step.cancelled ? t("summary.cancelled") : t("summary.done")}
        {t("summary.created", { pages: step.createdPages, tables: step.createdTables, pdfs: step.createdPdfs, failed: step.failedCount })}
      </p>
      {isConverting ? <ConvertStep step={step} controller={controller} /> : (
        <>
          {converting > 0 && (
            <p className={styles.meta}>
              {t("summary.converting", { count: converting })}
            </p>
          )}
          {unconverted > 0 && (
            <p className={styles.meta}>{t("summary.unconverted", { count: unconverted })}</p>
          )}
          <IngestStep step={step} controller={controller} />
        </>
      )}
    </>
  );
}

function ConvertStep({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  const estimate = convertEstimateOf(step.estimate);
  const count = estimate?.document_count ?? step.createdPdfs;
  const progress = step.convertProgress;
  const askCount = step.convert === "stopped" && progress ? Math.max(0, progress.total - progress.queued) : count;
  // 변환 예상치는 예약 상한이라 "최대"로 보여 준다(편입 예상 문구는 그대로).
  const label = estimate ? maxEstimateLabel(estimate, t) : t("cost.unknown");
  const convertMaxCost = estimate ? formatKrw(estimate.estimated_credits, t) : null;
  if (step.convert === "confirm" && estimate) {
    return (
      <ConfirmModal titleId="notion-import-convert-confirm"
        title={convertMaxCost ? t("convert.confirmMax", { amount: convertMaxCost }) : t("convert.confirmCount", { count })}
        description={t("convert.confirmMeta", { label, count, hint: t("cost.convertHint") })}
        confirmLabel={t("convert.continue")} cancelLabel={t("cancel")}
        onCancel={controller.cancelConvertConfirm} onConfirm={controller.confirmConvert} />
    );
  }
  const running = step.convert === "running";
  const unreadable = step.estimate?.pdf_unreadable_count ?? 0;
  return (
    <>
      <section className={styles.ingest} aria-labelledby="notion-import-convert">
        <h3 id="notion-import-convert">{t("convert.question", { count: askCount, label })}</h3>
        <p className={styles.meta}>{t("cost.convertHint")}</p>
        {unreadable > 0 && <p className={styles.meta}>{t("convert.unreadable", { count: unreadable })}</p>}
        <p className={styles.meta}>{t("convert.why")}</p>
        <p className={styles.meta}>{t("convert.qualityNotice")}</p>
        {running && progress && (
          <>
            <p className={styles.status} aria-live="polite">{t("convert.requesting", { queued: progress.queued, total: progress.total })}</p>
            <progress className={styles.progress} max={Math.max(1, progress.total)} value={progress.queued} aria-label={t("convert.progressLabel")} />
          </>
        )}
        {step.convertError && <p className={styles.error} role="alert">{step.convertError}</p>}
      </section>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={running} onClick={controller.skipConvert}>
          {step.convert === "stopped" ? t("convert.later") : t("convert.skip")}
        </button>
        <button type="button" className={styles.primary} disabled={running} aria-busy={running || undefined} onClick={controller.convertPdfs}>
          {step.convert === "stopped" ? t("convert.retry") : t("convert.all", { count })}
        </button>
      </div>
    </>
  );
}

function IngestStep({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  const t = useTranslations("notionImport");
  const count = step.estimate?.document_count ?? step.createdCount;
  const progress = step.ingestProgress;
  const ingestCost = step.estimate ? formatKrw(step.estimate.estimated_credits, t) : null;
  const isAsking = step.ingest === "idle" || step.ingest === "stopped";
  // 멈춘 뒤에는 아직 대기열에 넣지 못한 문서 수를 묻는다.
  const askCount = step.ingest === "stopped" && progress ? Math.max(0, progress.total - progress.queued) : count;
  return (
    <>
      {step.ingest === "done" && <p className={styles.status} role="status">{t("ingest.done", { count: progress?.queued ?? count })}</p>}
      {step.ingest === "skipped" && step.createdCount > 0 && <p className={styles.meta}>{t("ingest.skipped")}</p>}
      {(isAsking || step.ingest === "running") && (
        <section className={styles.ingest} aria-labelledby="notion-import-ingest">
          <h3 id="notion-import-ingest">{t("ingest.question", { count: askCount })}</h3>
          <p className={styles.meta}>{step.estimate ? estimateLabel(step.estimate, t) : step.estimateError ?? t("cost.unknown")}</p>
          {step.ingest === "running" && progress && (
            <>
              <p className={styles.status} aria-live="polite">{t("ingest.requesting", { queued: progress.queued, total: progress.total })}</p>
              <progress className={styles.progress} max={Math.max(1, progress.total)} value={progress.queued} aria-label={t("ingest.progressLabel")} />
            </>
          )}
          {step.ingestError && <p className={styles.error} role="alert">{step.ingestError}</p>}
        </section>
      )}
      {step.ingest === "confirm" && step.estimate && (
        <ConfirmModal titleId="notion-import-confirm"
          title={ingestCost ? t("ingest.confirmCost", { amount: ingestCost }) : t("ingest.confirmCount", { count })}
          description={t("ingest.confirmMeta", { label: estimateLabel(step.estimate, t), count })}
          confirmLabel={t("ingest.continue")} cancelLabel={t("cancel")}
          onCancel={controller.cancelIngestConfirm} onConfirm={controller.confirmIngest} />
      )}
      <div className={styles.actions}>
        {step.ingest === "confirm" ? null : isAsking || step.ingest === "running" ? (
          <>
            <button type="button" className={styles.secondary} disabled={step.ingest === "running"} onClick={controller.skipIngest}>
              {step.ingest === "stopped" ? t("ingest.later") : t("ingest.skip")}
            </button>
            <button type="button" className={styles.primary} disabled={step.ingest === "running"} aria-busy={step.ingest === "running" || undefined} onClick={controller.ingest}>
              {step.ingest === "stopped" ? t("ingest.retry") : t("ingest.all", { count })}
            </button>
          </>
        ) : (
          <button type="button" className={styles.primary} onClick={controller.close}>{t("close")}</button>
        )}
      </div>
    </>
  );
}
