"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ME_QUERY_KEY, updateDisplayName, useMe } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/errors";
import styles from "../SettingsModal.module.css";
import panelStyles from "./ProfilePanel.module.css";

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

  // 사진 업로드 API가 아직 없어 설정 메뉴·멤버 목록과 같은 이름 첫 글자 상자로 보여 준다.
  const avatarName = me?.display_name || me?.email || "사용자";

  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>프로필 설정</h2>
        </div>
        <p>워크스페이스 멤버에게 보이는 프로필을 관리합니다.</p>
      </div>

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>프로필 사진</span>
          <span className={styles["section-line"]} />
        </div>
        <div className={panelStyles.photo}>
          <span className={panelStyles.avatar} aria-hidden>{avatarName.charAt(0)}</span>
          <small className={panelStyles["photo-note"]}>닉네임의 첫 글자로 표시됩니다. 사진 업로드는 아직 지원하지 않습니다.</small>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>닉네임</span>
          <span className={styles["section-line"]} />
        </div>
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
