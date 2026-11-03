"use client";

import { formatBytes } from "@/entities/workspace/model/storageUsage";
import { CenteredModal } from "@/shared/ui/modal/CenteredModal";
import { previewBlocker, type NotionImportController, type NotionImportStep } from "../model/useNotionImport";
import type { ImportPlan } from "../lib/notionPlan";
import { CONVERT_COST_HINT, convertEstimateOf, estimateLabel, formatKrw, maxEstimateLabel } from "../model/importIngest";
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
  const pages = plan.documents.length - plan.tableCount - plan.rowPageCount;
  return (
    <dl className={styles.counts}>
      <div><dt>폴더</dt><dd>{plan.folders.length.toLocaleString()}</dd></div>
      <div><dt>문서</dt><dd>{pages.toLocaleString()}</dd></div>
      <div><dt>표(데이터베이스)</dt><dd>{plan.tableCount.toLocaleString()}</dd></div>
      {plan.rowPageCount > 0 && <div><dt>행 페이지</dt><dd>{plan.rowPageCount.toLocaleString()}</dd></div>}
      <div><dt>이미지</dt><dd>{plan.imageCount.toLocaleString()}</dd></div>
      {plan.pdfs.length > 0 && <div><dt>PDF</dt><dd>{plan.pdfs.length.toLocaleString()}</dd></div>}
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
        {` · ${plan.pdfs.length > 0 ? "문서·이미지·PDF" : "문서와 이미지"} ${plan.itemCount.toLocaleString()}개`}
      </p>
      <ul className={styles.notes}>
        {plan.rowPageCount > 0 && <li>행 페이지 {plan.rowPageCount.toLocaleString()}개 → 문서. 데이터베이스는 표 문서 옆 같은 이름 폴더에 행마다 문서로 넣고, 표의 제목 칸을 그 문서로 연결해요.</li>}
        {plan.pdfs.length > 0 && <li>PDF {plan.pdfs.length.toLocaleString()}개 → PDF 문서. PDF는 원본으로 가져오고, 변환은 가져오기 후 선택할 수 있어요. PPTX 등 다른 첨부는 가져오지 않고 본문 링크 글자만 남겨요.</li>}
        {plan.folders.some((folder) => folder.pageDocumentKey) && <li>하위 페이지가 있는 페이지는 같은 이름의 문서와 폴더로 나눠요. 문서 옆 폴더에 하위 페이지가 들어가요.</li>}
        {plan.notionLinkCount > 0 && <li>Notion 링크 {plan.notionLinkCount.toLocaleString()}개 → 앱 문서로 연결해요.</li>}
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

type SummaryStep = Extract<NotionImportStep, { kind: "summary" }>;

function Summary({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  // PDF 변환을 먼저 묻는다(변환이 편입의 전제). 정하고 나면 편입을 묻는다.
  const isConverting = step.convert === "idle" || step.convert === "confirm" || step.convert === "running" || step.convert === "stopped";
  const converting = step.estimate?.converting_count ?? 0;
  const unconverted = step.convert === "skipped" ? step.estimate?.pdf_unconverted_count ?? 0 : 0;
  return (
    <>
      <p className={styles.status} role="status">
        {step.cancelled ? "가져오기를 멈췄어요. " : "가져오기를 마쳤어요. "}
        문서 {step.createdPages.toLocaleString()}개{step.createdTables > 0 ? `, 표 ${step.createdTables.toLocaleString()}개` : ""}{step.createdPdfs > 0 ? `, PDF ${step.createdPdfs.toLocaleString()}개` : ""}를 만들었어요{step.failedCount > 0 ? `(가져오지 못한 항목 ${step.failedCount.toLocaleString()}개)` : ""}.
      </p>
      {isConverting ? <ConvertStep step={step} controller={controller} /> : (
        <>
          {converting > 0 && (
            <p className={styles.meta}>
              PDF {converting.toLocaleString()}개는 Markdown으로 변환하는 동안 문서 목록에 ‘변환 중’으로 보여요. 변환이 끝난 노트는 자동 편입하지 않으니 끝난 뒤 문서에서 편입해 주세요.
            </p>
          )}
          {unconverted > 0 && (
            <p className={styles.meta}>PDF {unconverted.toLocaleString()}개는 원본 PDF로 남겨 두었어요. 나중에 문서에서 Markdown으로 변환하면 위키에 편입할 수 있어요.</p>
          )}
          <IngestStep step={step} controller={controller} />
        </>
      )}
    </>
  );
}

function ConvertStep({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  const estimate = convertEstimateOf(step.estimate);
  const count = estimate?.document_count ?? step.createdPdfs;
  const progress = step.convertProgress;
  const askCount = step.convert === "stopped" && progress ? Math.max(0, progress.total - progress.queued) : count;
  // 변환 예상치는 예약 상한이라 "최대"로 보여 준다(편입 예상 문구는 그대로).
  const label = estimate ? maxEstimateLabel(estimate) : "예상 비용을 아직 알 수 없어요";
  if (step.convert === "confirm" && estimate) {
    return (
      <>
        <section className={styles.ingest} role="alertdialog" aria-labelledby="notion-import-convert-confirm">
          <h3 id="notion-import-convert-confirm">
            {formatKrw(estimate.estimated_credits) ? `최대 ${formatKrw(estimate.estimated_credits)}이 사용될 수 있어요. 계속할까요?` : `PDF ${count.toLocaleString()}개를 변환하면 비용이 많이 들 수 있어요. 계속할까요?`}
          </h3>
          <p className={styles.meta}>{label} · PDF {count.toLocaleString()}개. {CONVERT_COST_HINT}</p>
        </section>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={controller.cancelConvertConfirm}>취소</button>
          <button type="button" className={styles.primary} onClick={controller.confirmConvert}>계속 변환</button>
        </div>
      </>
    );
  }
  const running = step.convert === "running";
  return (
    <>
      <section className={styles.ingest} aria-labelledby="notion-import-convert">
        <h3 id="notion-import-convert">PDF {askCount.toLocaleString()}개를 문서로 변환할까요? ({label})</h3>
        <p className={styles.meta}>{CONVERT_COST_HINT}</p>
        <p className={styles.meta}>변환해야 위키에 편입할 수 있어요. 변환하지 않으면 원본 PDF로 남고, 나중에 문서에서 변환할 수 있어요.</p>
        {running && progress && (
          <>
            <p className={styles.status} aria-live="polite">변환 요청 중 {progress.queued.toLocaleString()}/{progress.total.toLocaleString()}</p>
            <progress className={styles.progress} max={Math.max(1, progress.total)} value={progress.queued} aria-label="PDF 변환 요청 진행률" />
          </>
        )}
        {step.convertError && <p className={styles.error} role="alert">{step.convertError}</p>}
      </section>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={running} onClick={controller.skipConvert}>
          {step.convert === "stopped" ? "나중에 하기" : "변환하지 않기"}
        </button>
        <button type="button" className={styles.primary} disabled={running} aria-busy={running || undefined} onClick={controller.convertPdfs}>
          {step.convert === "stopped" ? "남은 PDF 변환 다시 시도" : `PDF ${count.toLocaleString()}개 모두 변환`}
        </button>
      </div>
    </>
  );
}

function IngestStep({ step, controller }: { step: SummaryStep; controller: NotionImportController }) {
  const count = step.estimate?.document_count ?? step.createdCount;
  const progress = step.ingestProgress;
  const isAsking = step.ingest === "idle" || step.ingest === "stopped";
  // 멈춘 뒤에는 아직 대기열에 넣지 못한 문서 수를 묻는다.
  const askCount = step.ingest === "stopped" && progress ? Math.max(0, progress.total - progress.queued) : count;
  return (
    <>
      {step.ingest === "done" && <p className={styles.status} role="status">위키 편입 대기열에 {(progress?.queued ?? count).toLocaleString()}개를 넣었어요. 진행 상황은 위키 작업에서 볼 수 있어요.</p>}
      {step.ingest === "skipped" && step.createdCount > 0 && <p className={styles.meta}>위키 편입은 나중에 그래프 화면에서 문서를 골라 할 수 있어요.</p>}
      {(isAsking || step.ingest === "running") && (
        <section className={styles.ingest} aria-labelledby="notion-import-ingest">
          <h3 id="notion-import-ingest">{askCount.toLocaleString()}개 문서를 위키에 편입할까요?</h3>
          <p className={styles.meta}>{step.estimate ? estimateLabel(step.estimate) : step.estimateError ?? "예상 비용을 아직 알 수 없어요"}</p>
          {step.ingest === "running" && progress && (
            <>
              <p className={styles.status} aria-live="polite">편입 요청 중 {progress.queued.toLocaleString()}/{progress.total.toLocaleString()}</p>
              <progress className={styles.progress} max={Math.max(1, progress.total)} value={progress.queued} aria-label="위키 편입 요청 진행률" />
            </>
          )}
          {step.ingestError && <p className={styles.error} role="alert">{step.ingestError}</p>}
        </section>
      )}
      {step.ingest === "confirm" && step.estimate && (
        <section className={styles.ingest} role="alertdialog" aria-labelledby="notion-import-confirm">
          <h3 id="notion-import-confirm">
            {formatKrw(step.estimate.estimated_credits) ? `${formatKrw(step.estimate.estimated_credits)}이 사용될 수 있어요. 계속할까요?` : `문서 ${count.toLocaleString()}개를 편입하면 비용이 많이 들 수 있어요. 계속할까요?`}
          </h3>
          <p className={styles.meta}>{estimateLabel(step.estimate)} · 문서 {count.toLocaleString()}개. 실제 비용은 문서 길이에 따라 달라요.</p>
        </section>
      )}
      <div className={styles.actions}>
        {step.ingest === "confirm" ? (
          <>
            <button type="button" className={styles.secondary} onClick={controller.cancelIngestConfirm}>취소</button>
            <button type="button" className={styles.primary} onClick={controller.confirmIngest}>계속 편입</button>
          </>
        ) : isAsking || step.ingest === "running" ? (
          <>
            <button type="button" className={styles.secondary} disabled={step.ingest === "running"} onClick={controller.skipIngest}>
              {step.ingest === "stopped" ? "나중에 하기" : "편입하지 않기"}
            </button>
            <button type="button" className={styles.primary} disabled={step.ingest === "running"} aria-busy={step.ingest === "running" || undefined} onClick={controller.ingest}>
              {step.ingest === "stopped" ? "남은 문서 편입 다시 시도" : `${count.toLocaleString()}개 문서를 위키에 편입`}
            </button>
          </>
        ) : (
          <button type="button" className={styles.primary} onClick={controller.close}>닫기</button>
        )}
      </div>
    </>
  );
}
