import { useTranslations } from "next-intl";
import type { ConversionReportView } from "@/entities/document/lib/conversionReport";
import styles from "./SourcePreviewPanel.module.css";

/** PDF 변환 문서 위의 복원 결과 안내. 원문으로 대신한 쪽은 펼쳐서 쪽별 이유를 본다. */
export function ConversionReportNotice({ report }: { report: ConversionReportView }) {
  const t = useTranslations("documents.preview.conversionReport");
  const { figures } = report;
  return (
    <div className={styles["source-preview-conversion-report"]} role="note" aria-label={t("label")}>
      {report.fallbackPageCount > 0 && (
        <details>
          <summary>{t("fallbackTitle", { count: report.fallbackPageCount })}</summary>
          <p>{t("fallbackDescription")}</p>
          <ul>
            {report.pages.map(({ page, reason, causes }) => (
              <li key={page}>
                <strong>{t("page", { page })}</strong>
                <span>{t(`reasons.${reason}`)}</span>
                {causes.length > 0 && <small>{t("causes", { causes: causes.map((cause) => t(`reasons.${cause}`)).join(", ") })}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {figures && (
        <p className={styles["source-preview-conversion-figures"]}>
          {[
            t("figures.described", { count: figures.described }),
            ...(figures.failed > 0 ? [t("figures.failed", { count: figures.failed })] : []),
            ...(figures.skipped > 0 ? [t("figures.skipped", { count: figures.skipped })] : [])
          ].join(" · ")}
        </p>
      )}
    </div>
  );
}
