import type { ConversionReportView } from "@/entities/document/lib/conversionReport";
import styles from "./SourcePreviewPanel.module.css";

/** PDF 변환 문서 위의 복원 결과 안내. 원문으로 대신한 쪽은 펼쳐서 쪽별 이유를 본다. */
export function ConversionReportNotice({ report }: { report: ConversionReportView }) {
  return (
    <div className={styles["source-preview-conversion-report"]} role="note" aria-label="PDF 변환 결과">
      {report.fallbackTitle && (
        <details>
          <summary>{report.fallbackTitle}</summary>
          <p>글자가 깨진 쪽을 AI로 고치지 못해 PDF에서 뽑은 원문 텍스트를 그대로 넣었어요. 원본 PDF와 함께 확인해 주세요.</p>
          <ul>
            {report.pages.map(({ page, reason, causes }) => (
              <li key={page}>
                <strong>{page}쪽</strong>
                <span>{reason}</span>
                {causes.length > 0 && <small>함께 발견: {causes.join(", ")}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.figures && <p className={styles["source-preview-conversion-figures"]}>{report.figures}</p>}
    </div>
  );
}
