"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AVATAR_ACCEPT, ME_QUERY_KEY, UserAvatar, avatarUploadErrorMessage, deleteAvatar, updateDisplayName, uploadAvatar, useMe,
  validateAvatarFile, type UserMeResponse
} from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "../SettingsModal.module.css";
import { SettingsPanelTitle } from "../SettingsPanelTitle";
import panelStyles from "./ProfilePanel.module.css";
import { SettingsSectionHeader } from "../SettingsSectionHeader";

/** 프로필 설정 패널: 다른 멤버에게 보이는 사진과 닉네임. 이메일·비밀번호·보안은 계정 설정 패널에 있다. */
export function ProfilePanel() {
  const { data: me, error: loadError } = useMe();
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
      setNameError("닉네임을 입력해 주세요. 공백만으로는 저장할 수 없습니다.");
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
      setNameError(getErrorMessage(error, "닉네임을 변경하지 못했습니다."));
    } finally {
      nameRequestPending.current = false;
      setSavingName(false);
    }
  }, [me, nickname, nicknameDraft, composingName, queryClient]);

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
      setPhotoError(avatarUploadErrorMessage(error, fallback));
    } finally {
      setPhotoBusy(false);
    }
  }

  function savePhoto(file: File) {
    // 형식·1MB는 보내기 전에 거른다. 서버는 매직 바이트로 다시 판별해 400·413을 돌려줄 수 있다.
    const problem = validateAvatarFile(file);
    if (problem) {
      setPhotoMessage(null);
      setPhotoError(problem);
      return;
    }
    void applyPhoto(() => uploadAvatar(file), "프로필 사진을 변경했습니다.", "프로필 사진을 올리지 못했습니다.");
  }

  const avatarName = me?.display_name || me?.email || "사용자";

  return (
    <div className={styles.detail}>
      <SettingsPanelTitle title="프로필 설정" description="워크스페이스 멤버에게 보이는 프로필을 관리합니다." />

      <div className={styles.section}>
        <SettingsSectionHeader>프로필 사진</SettingsSectionHeader>
        <div className={panelStyles.photo}>
          <button type="button" className={panelStyles["avatar-button"]} aria-label="프로필 사진 업로드"
            disabled={!me || photoBusy} onClick={() => photoInput.current?.click()}>
            <UserAvatar avatarUrl={me?.avatar_url} name={avatarName} className={panelStyles.avatar} />
          </button>
          <input ref={photoInput} type="file" hidden accept={AVATAR_ACCEPT} disabled={!me || photoBusy}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) savePhoto(file); }} />
          <div className={panelStyles["photo-actions"]}>
            <small className={panelStyles["photo-note"]}>PNG·JPEG·WebP·GIF, 1MB 이하. 사진이 없으면 닉네임의 첫 글자로 표시됩니다.</small>
            <div className={panelStyles["photo-buttons"]}>
              <button type="button" className={panelStyles["photo-button"]} disabled={!me || photoBusy} onClick={() => photoInput.current?.click()}>
                사진 올리기
              </button>
              {me?.avatar_url && (
                <button type="button" className={panelStyles["photo-button"]} disabled={photoBusy}
                  onClick={() => void applyPhoto(deleteAvatar, "프로필 사진을 지웠습니다.", "프로필 사진을 지우지 못했습니다.")}>
                  사진 삭제
                </button>
              )}
            </div>
            {photoBusy && <small role="status">사진 저장 중…</small>}
            {photoMessage && <small role="status">{photoMessage}</small>}
            {photoError && <small className={styles["model-error"]} role="alert">{photoError}</small>}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <SettingsSectionHeader>닉네임</SettingsSectionHeader>
        <div className={styles.field}>
          <label htmlFor="profile-nickname">닉네임</label>
          <input id="profile-nickname" type="text" value={nickname} maxLength={255} required
            aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "profile-nickname-error" : undefined}
            disabled={!me} onChange={(event) => { setNicknameDraft(event.target.value); setNameSaved(false); setNameError(null); }}
            onCompositionStart={() => setComposingName(true)} onCompositionEnd={() => setComposingName(false)}
            onBlur={() => void saveName()} />
          {(nameError || loadError) && <small id="profile-nickname-error" className={styles["model-error"]} role="alert">{nameError || getErrorMessage(loadError, "계정 정보를 불러오지 못했습니다.")}</small>}
          {savingName ? <small role="status">저장 중…</small> : nameSaved && nicknameDraft === null && <small role="status">닉네임을 변경했습니다.</small>}
        </div>
      </div>
    </div>
  );
}
