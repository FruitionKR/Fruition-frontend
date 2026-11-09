import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** PDF를 Markdown으로 변환하기 전에 변환 품질을 안내하고 확인받는다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function PdfConvertConfirmModal({ filename, onConfirm, onCancel }: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wiki.ingest");
  return (
    <ConfirmModal
      titleId="pdf-convert-confirm-title"
      title={t("pdfConvertConfirm.title", { filename })}
      description={t("pdfConvertConfirm.description", { qualityNotice: t("pdfConvertQualityNotice") })}
      confirmLabel={t("confirm")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
