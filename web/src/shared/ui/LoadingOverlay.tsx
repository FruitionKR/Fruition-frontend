"use client";

import { useTranslations } from "next-intl";

/** 전체 화면 로딩 오버레이. 시간이 걸리는 작업(워크스페이스 생성 등) 중 표시한다. */
export function LoadingOverlay({ message }: { message?: string }) {
  const t = useTranslations("shared");
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay-spinner" aria-hidden />
      <p className="loading-overlay-message">{message ?? t("ui.loading")}</p>
    </div>
  );
}
