import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 위키 편입 선택에 변환 전 PDF가 섞였을 때 변환 후 편입을 확인한다. 변환 품질 안내도 여기서 함께 받아 확인창을 한 번만 띄운다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function PdfIngestConfirmModal({ pdfCount, onConfirm, onCancel }: {
  pdfCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wiki.ingest");
  return (
    <ConfirmModal
      titleId="pdf-ingest-confirm-title"
      title={t("pdfIngestConfirm.title")}
      description={t("pdfIngestConfirm.description", { count: pdfCount, qualityNotice: t("pdfConvertQualityNotice") })}
      confirmLabel={t("confirm")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
