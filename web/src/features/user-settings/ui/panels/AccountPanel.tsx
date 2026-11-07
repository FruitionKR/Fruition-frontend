"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMe } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { AccountDeleteModal } from "../modals/AccountDeleteModal";
import { SessionsPanel } from "./SessionsPanel";
import { MfaPanel } from "./MfaPanel";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

/**
 * 계정 보안 (Figma 1691:16255): 계정 관리(내 계정 삭제) + 계정 보안(다단계 인증·로그인된 기기).
 * 이메일·비밀번호·소셜 연동은 시안대로 사용자 설정으로 옮겼다.
 */
export function AccountPanel({
  resumeAccountDelete = false,
  onOpenMembers
}: {
  /** 소셜 재로그인에서 돌아와 탈퇴 확인 단계를 바로 다시 열 때 */
  resumeAccountDelete?: boolean;
  onOpenMembers: (workspaceId: string) => void;
}) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const { data: me, error: loadError } = useMe();
  const [showDelete, setShowDelete] = useState(resumeAccountDelete);

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title={t("account.title")} description={t("account.description")} />
      {loadError && <small className={styles["field-error"]} role="alert">{getErrorMessage(loadError, t("common.accountLoadFailed"), tShared)}</small>}

      {/* 설정을 연 뒤 한 번 클릭으로 탈퇴 화면에 닿아야 한다(다크패턴 방지 가이드라인). */}
      <div className={styles.section}>
        <SettingsSectionHeader>{t("account.manageSection")}</SettingsSectionHeader>
        <div className={styles.row}>
          <div className={styles["row-title"]}>
            <strong>{t("account.delete.title")}</strong>
            <small>{t("account.delete.description")}</small>
          </div>
          <button type="button" className={`${styles.btn} ${styles["btn-danger"]}`} disabled={!me} onClick={() => setShowDelete(true)}>
            {t("account.delete.button")}
          </button>
        </div>
        {showDelete && me && (
          <AccountDeleteModal
            me={me}
            initialStep={resumeAccountDelete ? "confirm" : "notice"}
            onOpenMembers={onOpenMembers}
            onClose={() => setShowDelete(false)}
          />
        )}
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("account.securitySection")}</SettingsSectionHeader>
        {me && <MfaPanel />}
        {me && <SessionsPanel />}
      </div>
    </div>
  );
}
