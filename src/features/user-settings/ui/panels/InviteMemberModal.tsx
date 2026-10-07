"use client";

import { ChevronRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { inviteMember, type WorkspaceRole } from "@/entities/workspace/api/members";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/errors";
import { settingScrollIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import styles from "./AccountFlowModal.module.css";
import { FlowModal } from "./FlowModal";
import membersStyles from "./MembersPanel.module.css";

/** 멤버 초대 모달. 성공하면 onInvited로 안내 문구를 넘기고 닫힌다. 실패하면 모달 안에 오류를 보여준다. */
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
    <FlowModal
      title="멤버 추가하기"
      subtitle="초대할 사람의 이메일과 권한을 입력하세요."
      ariaLabel="멤버 추가하기"
      canClose={!busy}
      onClose={onClose}
      onSubmit={(event) => void invite(event)}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="invite-email">초대할 이메일</label>
          <input
            id="invite-email"
            type="email"
            autoComplete="email"
            maxLength={255}
            placeholder="example@email.com"
            required
            autoFocus
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="invite-role">권한</label>
          <span className={cx(membersStyles["role-chip"], styles["field-role"])}>
            <select
              id="invite-role"
              className={membersStyles["role-select"]}
              value={role}
              disabled={busy}
              onChange={(event) => setRole(event.target.value as WorkspaceRole)}
            >
              <option value="MEMBER">MEMBER</option>
              <option value="OWNER">OWNER</option>
            </select>
            <SvgIcon src={settingScrollIcon} className={membersStyles["chev-icon"]} />
          </span>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </div>

      <div className={cx(styles.footer, styles["is-end"])}>
        <button type="submit" className={styles["btn-next"]} disabled={busy || email.trim().length === 0}>
          {busy ? "전송 중…" : "초대 보내기"}
          {!busy && <ChevronRight size={10} strokeWidth={2.5} aria-hidden />}
        </button>
      </div>
    </FlowModal>
  );
}
