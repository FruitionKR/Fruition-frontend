"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMfaStatus, registerMfa, MFA_QUERY_KEY, type MfaRegistration } from "@/entities/user";
import { getErrorMessage } from "@/shared/lib/errors";
import styles from "../SettingsModal.module.css";
import { MfaDisableModal, MfaSetupModal } from "./MfaModals";

/** 다단계 인증 스위치 행. 켜면 등록 모달, 끄면 해제 모달을 연다. */
export function MfaPanel() {
  const { data: status, error: loadError, refetch, isFetching } = useQuery({
    queryKey: MFA_QUERY_KEY, queryFn: fetchMfaStatus, retry: false
  });
  // 등록 키와 복구 코드는 모달이 열려 있는 동안 메모리에만 보관한다.
  const [registration, setRegistration] = useState<MfaRegistration | null>(null);
  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!status || busy || isFetching) return;
    setError(null);
    if (status.enabled) {
      setIsDisableOpen(true);
      return;
    }
    setBusy(true);
    try {
      setRegistration(await registerMfa());
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "다단계 인증 등록을 시작하지 못했습니다."));
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className={styles.row}>
      <div className={styles["row-title"]}>
        <strong>다단계 인증</strong>
        <small>{status?.enabled ? "다단계 인증 사용 중" : "로그인할 때 인증 앱의 코드를 추가로 확인합니다."}</small>
      </div>
      <button type="button" role="switch" aria-checked={status?.enabled ?? false} aria-label="다단계 인증"
        className={`${styles.switch} ${status?.enabled ? styles["is-on"] : ""}`}
        disabled={!status || busy || isFetching} onClick={() => void toggle()}>
        <span className={styles["switch-ball"]} />
      </button>
    </div>
    {(error || loadError) && <small className={styles["model-error"]} role="alert">{error || getErrorMessage(loadError, "다단계 인증 상태를 불러오지 못했습니다.")}</small>}
    {loadError && <button type="button" className={styles.btn} disabled={isFetching} onClick={() => void refetch()}>다시 확인</button>}

    {registration && (
      <MfaSetupModal
        registration={registration}
        onActivated={() => void refetch()}
        onClose={() => { setRegistration(null); void refetch(); }}
      />
    )}
    {isDisableOpen && (
      <MfaDisableModal
        onDisabled={() => { setIsDisableOpen(false); void refetch(); }}
        onClose={() => setIsDisableOpen(false)}
      />
    )}
  </>;
}
