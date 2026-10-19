"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { inviteMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import modalCloseIcon from "@/shared/assets/svg/settings/modal-close.svg";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { cx } from "@/shared/lib/classNames";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import flowStyles from "./AccountFlowModal.module.css";
import { FlowError, AccountFlowModal } from "./AccountFlowModal";
import styles from "./InviteMemberModal.module.css";

const ROLE_OPTIONS: ReadonlyArray<{ value: WorkspaceRole; label: string }> = [
  { value: "MEMBER", label: "MEMBER" },
  { value: "OWNER", label: "OWNER" }
];

/** 멤버 초대 모달 (Figma 1708:5354). 성공하면 onInvited로 안내 문구를 넘기고 닫힌다. 실패하면 모달 안에 오류를 보여준다. */
export function InviteMemberModal({
  workspaceId,
  onInvited,
  onClose
}: {
  workspaceId: string;
  onInvited: (message: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await inviteMember(workspaceId, email.trim(), role);
      onInvited("초대 메일을 보냈습니다. 상대가 수락하면 멤버 목록에 표시됩니다.");
    } catch (cause: unknown) {
      setError(getErrorMessage(cause, "초대 메일을 보내지 못했습니다."));
      setBusy(false);
    }
  }

  return (
    <AccountFlowModal
      title="멤버 초대"
      subtitle="초대할 사람의 이메일과 권한을 입력하세요."
      ariaLabel="멤버 초대"
      canClose={!busy}
      onClose={onClose}
      onSubmit={(event) => void invite(event)}
      className={styles.modal}
      closeIcon={<Image src={modalCloseIcon} alt="" aria-hidden />}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="invite-email">이메일</label>
          <input
            id="invite-email"
            type="email"
            autoComplete="email"
            maxLength={255}
            placeholder="Example@email.com"
            required
            autoFocus
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="invite-role">권한</label>
          {/* 권한 목록 (Figma 1610:9350): 닫힌 상자 아래로 띄워 펼치고 고른 권한에 체크 */}
          <OptionSelect
            id="invite-role"
            value={role}
            placeholder="권한 선택"
            options={ROLE_OPTIONS}
            disabled={busy}
            floating
            onChange={(value) => setRole(value as WorkspaceRole)}
          />
          <FlowError error={error} />
        </div>
      </div>

      <div className={cx(flowStyles.footer, flowStyles["is-end"])}>
        <button type="submit" className={styles.submit} disabled={busy || email.trim().length === 0}>
          {busy ? "전송 중…" : "초대하기"}
        </button>
      </div>
    </AccountFlowModal>
  );
}
