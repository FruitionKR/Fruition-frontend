"use client";

import { useState, type FormEvent } from "react";
import { disableMfa } from "@/entities/user";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import styles from "./AccountFlowModal.module.css";
import { FlowError, AccountFlowModal, FlowNextButton } from "./AccountFlowModal";

/** 다단계 인증 해제 모달 (Figma 1127:5158). */
export function MfaDisableModal({ onDisabled, onClose }: { onDisabled: () => void; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await disableMfa(code.trim());
      onDisabled();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "다단계 인증을 해제하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFlowModal
      title="다단계 인증 해제"
      subtitle="인증 앱의 코드 또는 복구 코드로 본인임을 확인해 주세요."
      ariaLabel="다단계 인증 해제"
      canClose={!busy}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className={styles.field}>
        <div className={styles["field-head"]}>
          <label htmlFor="mfa-disable-code">인증 코드 또는 복구 코드</label>
          <p className={styles["field-desc"]}>방금 사용한 코드라면 다음 코드가 표시된 뒤 입력해 주세요.</p>
        </div>
        <input
          id="mfa-disable-code"
          autoComplete="one-time-code"
          maxLength={64}
          placeholder="XXXXXX"
          autoFocus
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
        />
        <FlowError error={error} />
      </div>
      <div className={cx(styles.footer, styles["is-end"])}>
        <FlowNextButton className={styles["is-dim"]} disabled={busy || !code.trim()} showChevron={!busy}>
          {busy ? "확인 중…" : "다단계 인증 해제"}
        </FlowNextButton>
      </div>
    </AccountFlowModal>
  );
}
