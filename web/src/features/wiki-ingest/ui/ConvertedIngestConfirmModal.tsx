import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/shared/ui/modal/ConfirmModal";

/** 아직 편입하지 않은 PDF 변환본을 열었을 때 위키 편입을 묻는다. ESC·바깥 클릭은 AlertModal이 취소로 처리한다. */
export function ConvertedIngestConfirmModal({ filename, onConfirm, onCancel }: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wiki.ingest");
  return (
    <ConfirmModal
      titleId="converted-ingest-confirm-title"
      title={t("convertedConfirm.title")}
      description={t("convertedConfirm.description", { filename })}
      confirmLabel={t("confirm")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
