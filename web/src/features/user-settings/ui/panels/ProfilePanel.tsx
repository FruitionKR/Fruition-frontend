"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AVATAR_ACCEPT, ME_QUERY_KEY, UserAvatar, avatarUploadErrorMessage, deleteAvatar, updateDisplayName, uploadAvatar, useMe,
  validateAvatarFile, type UserMeResponse
} from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import { SettingsSectionHeader } from "../SettingsSectionHeader";
import { EmailChangeModal } from "../modals/EmailChangeModal";
import { PasswordChangeModal } from "../modals/PasswordChangeModal";
import { LinkedAccountsSection } from "./LinkedAccountsSection";
import panelStyles from "./ProfilePanel.module.css";

/**
 * 사용자 설정 (Figma 1691:16583): 프로필(닉네임·프로필 사진) + 계정 정보(이메일·비밀번호) + 연동된 계정.
 * 예전 프로필 설정과 계정 설정(이메일·비밀번호·소셜 연동)을 시안대로 한 화면에 합쳤다. 탈퇴·다단계 인증·기기는 계정 보안에 있다.
 */
export function ProfilePanel({
  resumeEmailChange = false
}: {
  /** 소셜 재로그인에서 돌아와 이메일 변경 창을 바로 다시 열 때 */
  resumeEmailChange?: boolean;
}) {
  const t = useTranslations("settings");
  const tShared = useTranslations("shared");
  const { data: me, error: loadError } = useMe();
  const [showEmail, setShowEmail] = useState(resumeEmailChange);
  const [emailSaved, setEmailSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const queryClient = useQueryClient();
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const nickname = nicknameDraft ?? me?.display_name ?? "";
  const nameRequestPending = useRef(false);
  const [composingName, setComposingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  const saveName = useCallback(async () => {
    if (!me || nameRequestPending.current || composingName || nicknameDraft === null) return;
    if (!nickname.trim()) {
      setNameSaved(false);
      setNameError(t("profile.nickname.required"));
      return;
    }
    if (nickname.trim() === me.display_name) return;
    nameRequestPending.current = true;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const updated = await updateDisplayName(nickname.trim());
      // 설정 메뉴와 사이드바가 같은 사용자 캐시를 사용한다.
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      setNicknameDraft((current) => current === nickname ? null : current);
      setNameSaved(true);
    } catch (error: unknown) {
      setNameError(getErrorMessage(error, t("profile.nickname.saveFailed"), tShared));
    } finally {
      nameRequestPending.current = false;
      setSavingName(false);
    }
  }, [me, nickname, nicknameDraft, composingName, queryClient, t, tShared]);

  useEffect(() => {
    if (savingName || nameError || composingName || nicknameDraft === null) return;
    const timer = window.setTimeout(() => void saveName(), 600);
    return () => window.clearTimeout(timer);
  }, [saveName, savingName, nameError, composingName, nicknameDraft]);

  /** 사진 업로드·삭제 공통. 응답 MeResponse로 me 캐시를 바로 바꿔 레일·설정 메뉴가 같이 갱신되고, 멤버 목록은 다시 읽게 한다. */
  async function applyPhoto(request: () => Promise<UserMeResponse>, done: string, fallback: string) {
    if (!me || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoMessage(null);
    try {
      const updated = await request();
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      setPhotoMessage(done);
    } catch (error: unknown) {
      setPhotoError(avatarUploadErrorMessage(error, fallback, tShared));
    } finally {
      setPhotoBusy(false);
    }
  }

  function savePhoto(file: File) {
    // 형식·1MB는 보내기 전에 거른다. 서버는 매직 바이트로 다시 판별해 400·413을 돌려줄 수 있다.
    const problem = validateAvatarFile(file, tShared);
    if (problem) {
      setPhotoMessage(null);
      setPhotoError(problem);
      return;
    }
    void applyPhoto(() => uploadAvatar(file), t("profile.photo.uploaded"), t("profile.photo.uploadFailed"));
  }

  const avatarName = me?.display_name || me?.email || t("common.userFallback");

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title={t("profile.title")} description={t("profile.description")} />

      <div className={styles.section}>
        <SettingsSectionHeader>{t("profile.section")}</SettingsSectionHeader>
        <div className={panelStyles["profile-list"]}>
          <div className={cx(styles.field, panelStyles["profile-field"])}>
            <label htmlFor="profile-nickname">{t("profile.nickname.label")}</label>
            <input id="profile-nickname" type="text" value={nickname} maxLength={255} required
              aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "profile-nickname-error" : undefined}
              disabled={!me} onChange={(event) => { setNicknameDraft(event.target.value); setNameSaved(false); setNameError(null); }}
              onCompositionStart={() => setComposingName(true)} onCompositionEnd={() => setComposingName(false)}
              onBlur={() => void saveName()} />
            {(nameError || loadError) && <small id="profile-nickname-error" className={styles["field-error"]} role="alert">{nameError || getErrorMessage(loadError, t("common.accountLoadFailed"), tShared)}</small>}
            {savingName ? <small role="status">{t("common.saving")}</small> : nameSaved && nicknameDraft === null && <small role="status">{t("profile.nickname.saved")}</small>}
          </div>

          <div className={styles["tile-field"]}>
            <div className={styles["row-title"]}>
              <strong>{t("profile.photo.label")}</strong>
              {/* 시안 문구는 "업로드 미지원"이지만 사진 업로드 API(#avatar)가 있어 실제 동작을 안내한다. */}
              {/* 사진이 있으면 첫 글자 대신 사진이 보이므로 바꾸기·삭제를 안내한다. */}
              <small>
                {me?.avatar_url ? t("profile.photo.hintWithPhoto") : t("profile.photo.hintWithoutPhoto")}
              </small>
            </div>
            <button type="button" className={styles["tile-button"]} aria-label={t("profile.photo.upload")}
              disabled={!me || photoBusy} onClick={() => photoInput.current?.click()}>
              <UserAvatar avatarUrl={me?.avatar_url} name={avatarName} className={styles["tile-face"]} />
            </button>
            <input ref={photoInput} type="file" hidden accept={AVATAR_ACCEPT} disabled={!me || photoBusy}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) savePhoto(file); }} />
            {(me?.avatar_url || photoBusy || photoMessage || photoError) && (
              <div className={styles["tile-actions"]}>
                {me?.avatar_url && (
                  <button type="button" className={styles.btn} disabled={photoBusy}
                    onClick={() => void applyPhoto(deleteAvatar, t("profile.photo.deleted"), t("profile.photo.deleteFailed"))}>
                    {t("profile.photo.delete")}
                  </button>
                )}
                {photoBusy && <small className={styles["status-text"]} role="status">{t("profile.photo.saving")}</small>}
                {photoMessage && <small className={styles["status-text"]} role="status">{photoMessage}</small>}
                {photoError && <small className={styles["field-error"]} role="alert">{photoError}</small>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>{t("profile.accountSection")}</SettingsSectionHeader>
        <div className={panelStyles["account-list"]}>
          <div className={cx(styles.row, panelStyles["account-row"])}>
            <div className={styles["row-title"]}>
              <strong>{t("profile.email.label")}</strong>
              <small>{me?.email || t("profile.email.loadFailed")}</small>
            </div>
            <button type="button" className={styles.btn} disabled={!me}
              onClick={() => { setShowEmail(true); setEmailSaved(false); }}>
              {t("profile.email.change")}
            </button>
          </div>
          {emailSaved && <small className={styles["status-text"]} role="status">{t("profile.email.changed")}</small>}
          <div className={cx(styles.row, panelStyles["account-row"])}>
            <div className={styles["row-title"]}>
              <strong>{t("profile.password.label")}</strong>
              <small>{t("profile.password.description")}</small>
            </div>
            <button type="button" className={styles.btn} disabled={!me} onClick={() => setShowPassword(true)}>
              {t("profile.password.change")}
            </button>
          </div>
        </div>
      </div>

      <LinkedAccountsSection me={me} />

      {showEmail && me && (
        <EmailChangeModal
          me={me}
          onSaved={() => { setShowEmail(false); setEmailSaved(true); }}
          onClose={() => setShowEmail(false)}
        />
      )}
      {showPassword && me && (
        <PasswordChangeModal
          email={me.email}
          // 비밀번호를 바꿔도 현재 세션은 유지된다(다른 세션만 폐기). 완료 안내 뒤 창만 닫는다.
          onSaved={() => setShowPassword(false)}
          onClose={() => setShowPassword(false)}
        />
      )}
    </div>
  );
}
