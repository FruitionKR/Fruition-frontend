"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDocuments,
  fetchSkillReferenceDocuments,
  uploadSkillReferenceDocument,
  type DocumentItemResponse
} from "@/entities/document";
import { Tooltip } from "@/shared/ui/Tooltip";
import { chevronDownSmallIcon, menuSearchIcon, questionMarkIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { ReferenceDocumentPickerModal } from "./ReferenceDocumentPickerModal";
import { documentDisplayName } from "../lib/referenceDocumentPicker";
import { SKILL_KIND_CARDS, SKILL_TARGET_OPTIONS, type SkillTarget } from "../lib/skillCreateForm";
import styles from "./SkillEditor.module.css";

/** 스킬 만들기·스킬 상세 시트가 함께 쓰는 입력 조각. */

export const REFERENCE_DOC_MAX = 3;

// 안전 검토 issue category 한글 라벨 (AI safety 검사 카테고리)
const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  approval_bypass: "권한 우회 표현",
  sensitive_info: "민감정보로 보이는 내용",
  tool_policy: "허용되지 않은 도구 사용",
  permission_escalation: "권한을 넓히려는 표현",
  forbidden_tool: "허용되지 않은 도구 사용",
  policy_weakening: "안전 정책을 약화하는 표현",
  hidden_prompt: "숨겨진 지시",
  role_override: "역할을 바꾸려는 표현",
  instruction_override: "기존 지시를 무시하게 하는 표현",
  credential: "인증 정보로 보이는 내용",
  secret: "비밀 정보로 보이는 내용"
};

/** 게시 응답 issues 항목({category, text, reason, ...})을 표시용 텍스트로 변환한다. */
export function issueText(issue: unknown): string {
  if (issue != null && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const category = typeof record.category === "string" ? record.category : "";
    const title = ISSUE_CATEGORY_LABELS[category] ?? String(record.reason ?? (category || "안전 검토 지적"));
    return record.text ? `${title} — "${String(record.text)}"` : title;
  }
  return String(issue);
}

/** Figma check(20×20) 체크 표시. 테두리 상자는 CSS가 그린다. */
export function CheckMark() {
  return (
    <svg aria-hidden className={styles["check-mark"]} width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5.45312 9.20794L9.19644 12.727L14.9986 7.27246" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 라벨 옆 물음표 설명 */
export function HelpTip({ label, content }: { label: string; content: ReactNode }) {
  return (
    <Tooltip content={content} placement="top" describe={false}>
      <button type="button" className={styles["help-button"]} aria-label={`${label} 설명`}>
        <SvgIcon src={questionMarkIcon} className={styles["help-icon"]} />
      </button>
    </Tooltip>
  );
}

/** Figma btn(선택 상자): 네이티브 select에 Figma 화살표를 겹친다. compact는 테스트 실행 카드의 작은 선택 상자(Figma 1671:14817)다. */
export function SelectBox<T extends string>({
  id,
  value,
  options,
  disabled,
  describedBy,
  compact,
  onChange
}: {
  id: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  describedBy?: string;
  compact?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles["select-wrap"]}>
      <select
        id={id}
        className={compact ? `${styles.select} ${styles["select-compact"]}` : styles.select}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <SvgIcon src={chevronDownSmallIcon} className={styles["select-arrow"]} />
    </div>
  );
}

/** 대상 체크 (현재 문서 / 선택한 부분) */
export function TargetChecks({
  targets,
  onToggle
}: {
  targets: readonly SkillTarget[];
  onToggle: (target: SkillTarget, checked: boolean) => void;
}) {
  return (
    <div className={styles.checks}>
      {SKILL_TARGET_OPTIONS.map((option) => (
        <label key={option.value} className={styles["check-row"]}>
          <span className={styles.check}>
            <input
              type="checkbox"
              checked={targets.includes(option.value)}
              onChange={(event) => onToggle(option.value, event.target.checked)}
            />
            <CheckMark />
          </span>
          <span className={styles["check-label"]}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export const SCOPE_HELP = (
  <>
    개인 - 모든 워크스페이스에서 사용됩니다.
    <br />
    팀 - 현재 워크스페이스에서 사용됩니다.
  </>
);

/** 스킬 종류 물음표 설명 (종류별 한 줄) */
export const KIND_HELP = (
  <>
    {SKILL_KIND_CARDS.map((card, index) => (
      <span key={card.value}>
        {index > 0 && <br />}
        {card.label} - {card.description}
      </span>
    ))}
  </>
);

export const RESULT_HELP = (
  <>
    새 문서로 만들기 - 결과를 새 문서로 저장합니다.
    <br />
    열린 문서 고치기 - 실행한 문서를 바로 고칩니다.
    <br />
    상황에 맞게 - 요청에 따라 Agent가 고릅니다.
  </>
);

/**
 * 참고 문서 선택 상태(최대 3개)와 선택 모달. AI 작성 요청에만 쓰인다(게시·수정 API는 참고 문서를 받지 않는다).
 * 스킬 참고 문서는 기본 목록에 나오지 않아 따로 조회하고, 메인 트리 캐시와 키를 나눠 업로드가 트리에 섞이지 않게 한다.
 */
export function useReferenceDocuments(workspaceId: string) {
  const [selectedDocs, setSelectedDocs] = useState<DocumentItemResponse[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: documents } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: fetchDocuments,
    enabled: isPickerOpen
  });
  const referenceDocumentsKey = ["skill-reference-documents", workspaceId];
  const { data: referenceDocuments } = useQuery({
    queryKey: referenceDocumentsKey,
    queryFn: fetchSkillReferenceDocuments,
    enabled: isPickerOpen
  });

  /** 피커에서 올린 참고 문서를 목록 맨 앞에 넣고 선택한다. */
  async function uploadReferenceDocument(file: File): Promise<DocumentItemResponse> {
    const uploaded = await uploadSkillReferenceDocument(file);
    queryClient.setQueryData<DocumentItemResponse[]>(referenceDocumentsKey, (current = []) => [
      uploaded,
      ...current.filter((doc) => doc.id !== uploaded.id)
    ]);
    setSelectedDocs((current) =>
      current.some((doc) => doc.id === uploaded.id) || current.length >= REFERENCE_DOC_MAX ? current : [uploaded, ...current]
    );
    return uploaded;
  }

  const pickerModal = isPickerOpen ? (
    <ReferenceDocumentPickerModal
      documents={documents ?? []}
      referenceDocuments={referenceDocuments ?? []}
      selectedDocs={selectedDocs}
      maxCount={REFERENCE_DOC_MAX}
      onToggle={(doc) =>
        setSelectedDocs((current) =>
          current.some((item) => item.id === doc.id) ? current.filter((item) => item.id !== doc.id) : [...current, doc]
        )
      }
      onUpload={uploadReferenceDocument}
      onClose={() => setIsPickerOpen(false)}
    />
  ) : null;

  return {
    selectedDocs,
    selectedDocIds: selectedDocs.map((doc) => doc.id),
    removeDoc: (id: string) => setSelectedDocs((current) => current.filter((item) => item.id !== id)),
    openPicker: () => setIsPickerOpen(true),
    pickerModal
  };
}

/** 참고 문서 칩 + 'AI로 작성·보강' 버튼 + 상태 안내 (실행 규칙 아래) */
export function SkillAuthorAssist({
  selectedDocs,
  onOpenPicker,
  onRemoveDoc,
  isBusy,
  isAuthoring,
  status,
  idleHint,
  onAuthor
}: {
  selectedDocs: readonly DocumentItemResponse[];
  onOpenPicker: () => void;
  onRemoveDoc: (id: string) => void;
  isBusy: boolean;
  isAuthoring: boolean;
  status: string;
  idleHint: string;
  onAuthor: () => void;
}) {
  return (
    <>
      <div className={styles.assist}>
        <div className={styles["assist-docs"]}>
          <button
            type="button"
            className={styles["chip-neutral"]}
            aria-label={`참고 문서 선택 (${selectedDocs.length}/${REFERENCE_DOC_MAX})`}
            onClick={onOpenPicker}
          >
            <SvgIcon src={menuSearchIcon} className={styles["chip-icon"]} />
            참고 문서 {selectedDocs.length}/{REFERENCE_DOC_MAX}
          </button>
          {selectedDocs.map((doc) => (
            <span key={doc.id} className={styles["doc-chip"]}>
              <span className={styles["doc-chip-name"]}>{documentDisplayName(doc)}</span>
              <button
                type="button"
                className={styles["doc-chip-remove"]}
                aria-label={`${documentDisplayName(doc)} 선택 해제`}
                onClick={() => onRemoveDoc(doc.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={onAuthor}>
          <span aria-hidden>✦</span>
          {isAuthoring ? "AI가 작성하는 중…" : "AI로 작성·보강"}
        </button>
      </div>
      <p className={styles.hint} role="status" aria-live="polite">
        {status || idleHint}
      </p>
    </>
  );
}

/** 안전 검토 지적 목록 + 다시 만들기/다시 검토 */
export function SkillSafetyIssues({
  issues,
  isBusy,
  onRegenerate,
  onPreserve
}: {
  issues: readonly unknown[];
  isBusy: boolean;
  onRegenerate: () => void;
  onPreserve: () => void;
}) {
  if (issues.length === 0) return null;
  return (
    <div className={styles.issues} role="alert">
      <p className={styles["issues-title"]}>안전 검토에서 저장하지 못했습니다. 실행 규칙을 고쳐 주세요.</p>
      <ul className={styles["issue-list"]}>
        {issues.map((issue, index) => (
          <li key={index}>{issueText(issue)}</li>
        ))}
      </ul>
      <div className={styles["issue-actions"]}>
        <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={onRegenerate}>
          <span aria-hidden>✦</span>
          AI로 안전하게 다시 만들기
        </button>
        <button type="button" className={styles["chip-neutral"]} disabled={isBusy} onClick={onPreserve}>
          고친 내용 다시 검토
        </button>
      </div>
    </div>
  );
}
