"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  fetchDocuments,
  fetchSkillReferenceDocuments,
  uploadSkillReferenceDocument,
  type DocumentItemResponse
} from "@/entities/document";
import { invalidateStorageUsage } from "@/entities/workspace";
import { OptionSelect } from "@/shared/ui/OptionSelect";
import { Tooltip } from "@/shared/ui/Tooltip";
import { menuSearchIcon, questionMarkIcon, SvgIcon } from "@/shared/ui/SvgIcon";
import { ReferenceDocumentPickerModal } from "./ReferenceDocumentPickerModal";
import { documentDisplayName } from "../lib/referenceDocumentPicker";
import {
  requiresSourceFromChoice,
  SKILL_KIND_CARDS,
  SKILL_RESULT_MODES,
  SKILL_SCOPES,
  SKILL_SOURCE_CHOICES,
  SKILL_TARGETS,
  skillKindLabel,
  skillResultModeLabel,
  skillScopeLabel,
  skillTargetLabel,
  sourceChoice,
  sourceHint,
  sourceLabel,
  sourceUnsetLabel,
  type SkillTarget
} from "../lib/skillCreateForm";
import type { SkillsTranslate } from "../lib/skillsTranslate";
import styles from "./SkillEditor.module.css";

/** 스킬 만들기·스킬 상세 시트가 함께 쓰는 입력 조각. */

export const REFERENCE_DOC_MAX = 3;

// 안전 검토 issue category(AI safety 검사 카테고리). 이름은 skills 메시지 review.categories에 둔다.
const ISSUE_CATEGORIES = [
  "approval_bypass",
  "sensitive_info",
  "tool_policy",
  "permission_escalation",
  "forbidden_tool",
  "policy_weakening",
  "hidden_prompt",
  "role_override",
  "instruction_override",
  "credential",
  "secret"
] as const;

type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

function isIssueCategory(value: string): value is IssueCategory {
  return (ISSUE_CATEGORIES as readonly string[]).includes(value);
}

/** 게시 응답 issues 항목({category, text, reason, ...})을 표시용 텍스트로 변환한다. 모르는 category는 서버가 준 reason을 쓴다. */
export function issueText(issue: unknown, t: SkillsTranslate): string {
  if (issue != null && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const category = typeof record.category === "string" ? record.category : "";
    const title = isIssueCategory(category)
      ? t(`review.categories.${category}`)
      : String(record.reason ?? (category || t("review.issueDefault")));
    return record.text ? t("review.issueWithText", { title, text: String(record.text) }) : title;
  }
  return String(issue);
}

/** 선택 상자에 넣을 종류·결과 방식·저장범위·원문 문서 선택지(현재 언어 이름). */
export function useSkillOptions() {
  const t = useTranslations("skills");
  return {
    kindOptions: SKILL_KIND_CARDS.map((value) => ({ value, label: skillKindLabel(value, t) })),
    resultOptions: SKILL_RESULT_MODES.map((value) => ({ value, label: skillResultModeLabel(value, t) })),
    scopeOptions: SKILL_SCOPES.map((value) => ({ value, label: skillScopeLabel(value, t) })),
    sourceOptions: SKILL_SOURCE_CHOICES.map((value) => ({ value, label: t(`sources.${value}`) }))
  };
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
  const t = useTranslations("skills");
  return (
    <Tooltip content={content} placement="top" describe={false} openOnTap>
      <button type="button" className={styles["help-button"]} aria-label={t("help.label", { label })}>
        <SvgIcon src={questionMarkIcon} className={styles["help-icon"]} />
      </button>
    </Tooltip>
  );
}

/** Figma 드롭다운(1610:9350) 선택 상자. 목록은 아래 필드를 밀지 않게 띄운다. */
export function SelectBox<T extends string>({
  id,
  value,
  options,
  placeholder = "",
  disabled,
  describedBy,
  onChange
}: {
  id: string;
  /** null이면 아직 고르지 않아 placeholder를 보여 준다. */
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: T) => void;
}) {
  return (
    <OptionSelect
      id={id}
      value={value}
      placeholder={placeholder}
      options={options}
      disabled={disabled}
      describedBy={describedBy}
      size="md"
      floating
      onChange={(next) => onChange(next as T)}
    />
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
  const t = useTranslations("skills");
  return (
    <div className={styles.checks}>
      {SKILL_TARGETS.map((target) => (
        <label key={target} className={styles["check-row"]}>
          <span className={styles.check}>
            <input
              type="checkbox"
              checked={targets.includes(target)}
              onChange={(event) => onToggle(target, event.target.checked)}
            />
            <CheckMark />
          </span>
          <span className={styles["check-label"]}>{skillTargetLabel(target, t)}</span>
        </label>
      ))}
    </div>
  );
}

/** 저장범위 물음표 설명 */
export function ScopeHelp() {
  const t = useTranslations("skills");
  return (
    <>
      {t("help.scopePersonal")}
      <br />
      {t("help.scopeTeam")}
    </>
  );
}

/** 스킬 종류 물음표 설명 (종류별 한 줄) */
export function KindHelp() {
  const t = useTranslations("skills");
  return (
    <>
      {SKILL_KIND_CARDS.map((kind, index) => (
        <span key={kind}>
          {index > 0 && <br />}
          {t("help.kindLine", { label: skillKindLabel(kind, t), description: t(`kindDescriptions.${kind}`) })}
        </span>
      ))}
    </>
  );
}

/** 결과 방식 물음표 설명 */
export function ResultHelp() {
  const t = useTranslations("skills");
  return (
    <>
      {t("help.resultCreate")}
      <br />
      {t("help.resultEdit")}
      <br />
      {t("help.resultAuto")}
    </>
  );
}

/** 원문 문서 물음표 설명 */
export function SourceHelp() {
  const t = useTranslations("skills");
  return (
    <>
      {t("help.sourceRead")}
      <br />
      {t("help.sourceSkip")}
    </>
  );
}

/**
 * '원문 문서' 필드(requires_source). 읽음·읽지 않음을 고르고, 고르기 전(null)에는 '고르지 않음'과 게시 규칙 안내를 보인다.
 * note가 있으면 AI가 값을 정했다고 알리고 이전 값(고르지 않음일 수 있다)으로 되돌리는 버튼을 둔다.
 */
export function SourceField({
  id,
  value,
  note,
  onChange,
  onUndo
}: {
  id: string;
  value: boolean | null;
  note?: { from: boolean | null; to: boolean } | null;
  onChange: (value: boolean) => void;
  onUndo?: () => void;
}) {
  const t = useTranslations("skills");
  const { sourceOptions } = useSkillOptions();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <div className={styles["label-row"]}>
        <label className={styles.label} htmlFor={id}>
          {t("form.source")}
        </label>
        <HelpTip label={t("form.source")} content={<SourceHelp />} />
      </div>
      <div className={styles.menu}>
        <SelectBox
          id={id}
          value={sourceChoice(value)}
          options={sourceOptions}
          placeholder={sourceUnsetLabel(t)}
          describedBy={hintId}
          onChange={(choice) => onChange(requiresSourceFromChoice(choice))}
        />
        <p id={hintId} className={styles.hint}>
          {sourceHint(value, t)}
        </p>
        {note && onUndo && value === note.to && (
          <p className={styles["result-note"]} role="status">
            <span>{t("form.sourceNote", { value: sourceLabel(note.to, t) })}</span>
            <button type="button" className={styles["result-note-undo"]} onClick={onUndo}>
              {t("form.sourceUndo", { value: note.from == null ? sourceUnsetLabel(t) : sourceLabel(note.from, t) })}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

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
    invalidateStorageUsage(queryClient);
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
  const t = useTranslations("skills");
  return (
    <>
      <div className={styles.assist}>
        <div className={styles["assist-docs"]}>
          <button
            type="button"
            className={styles["chip-neutral"]}
            aria-label={t("assist.openPicker", { count: selectedDocs.length, max: REFERENCE_DOC_MAX })}
            onClick={onOpenPicker}
          >
            <SvgIcon src={menuSearchIcon} className={styles["chip-icon"]} />
            {t("assist.chip", { count: selectedDocs.length, max: REFERENCE_DOC_MAX })}
          </button>
          {selectedDocs.map((doc) => (
            <span key={doc.id} className={styles["doc-chip"]}>
              <span className={styles["doc-chip-name"]}>{documentDisplayName(doc)}</span>
              <button
                type="button"
                className={styles["doc-chip-remove"]}
                aria-label={t("assist.removeDoc", { name: documentDisplayName(doc) })}
                onClick={() => onRemoveDoc(doc.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={onAuthor}>
          <span aria-hidden>✦</span>
          {isAuthoring ? t("assist.authoring") : t("assist.author")}
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
  /** 없으면(상세 시트) AI 다시 만들기 버튼 없이 지적만 보여 준다. 실행 규칙을 고쳐 다시 저장하면 다시 검토한다. */
  onRegenerate?: () => void;
  onPreserve?: () => void;
}) {
  // 시트 아래쪽에 생기면 보이지 않아 저장이 안 된 이유를 모른다. 새 지적이 오면 지적까지 스크롤한다.
  const t = useTranslations("skills");
  const issuesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (issues.length > 0) issuesRef.current?.scrollIntoView({ block: "nearest" });
  }, [issues]);
  if (issues.length === 0) return null;
  return (
    <div className={styles.issues} ref={issuesRef} role="alert">
      <p className={styles["issues-title"]}>{t("review.issuesTitle")}</p>
      <ul className={styles["issue-list"]}>
        {issues.map((issue, index) => (
          <li key={index}>{issueText(issue, t)}</li>
        ))}
      </ul>
      {onRegenerate != null && onPreserve != null && (
        <div className={styles["issue-actions"]}>
          <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={onRegenerate}>
            <span aria-hidden>✦</span>
            {t("review.regenerate")}
          </button>
          <button type="button" className={styles["chip-neutral"]} disabled={isBusy} onClick={onPreserve}>
            {t("review.preserve")}
          </button>
        </div>
      )}
    </div>
  );
}
