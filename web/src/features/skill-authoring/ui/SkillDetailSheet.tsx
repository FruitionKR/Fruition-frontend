"use client";

import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authorSkill, type SkillResponse } from "@/entities/skill";
import type { SkillAuthoringResult } from "@/entities/skill/model/skill";
import { SideSheet } from "@/shared/ui/modal/SideSheet";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { describeSkillAuthorError, skillAuthoringOutcome } from "../lib/skillAuthoring";
import {
  isDocumentKind,
  SKILL_KIND_OPTIONS,
  SKILL_NAME_MAX,
  SKILL_RESULT_OPTIONS,
  SKILL_SCOPE_OPTIONS,
  SKILL_TARGET_OPTIONS,
  skillAuthorRequest,
  type SkillAuthoringMode,
  type SkillTarget
} from "../lib/skillCreateForm";
import {
  applySkillDetailDraft,
  skillDetailAuthorForm,
  skillDetailDraft,
  skillDetailForm,
  validateSkillDetailForm,
  type SkillDetailDraft,
  type SkillDetailField,
  type SkillDetailForm
} from "../lib/skillDetailForm";
import {
  CheckMark,
  HelpTip,
  RESULT_HELP,
  SCOPE_HELP,
  SelectBox,
  SkillAuthorAssist,
  SkillSafetyIssues,
  useReferenceDocuments
} from "./SkillFormParts";
import styles from "./SkillCreateSheet.module.css";
import detailStyles from "./SkillDetailSheet.module.css";

const CLARIFY_FALLBACK = "무엇을 할지 조금 더 구체적으로 적어 주세요.";
const REVIEW_FALLBACK = "안전 검토에서 위험한 표현이 발견되었습니다.";

/**
 * 스킬 상세 시트 (Figma 1708:4059). 목록 행 클릭·더보기 '수정'으로 연다.
 * 설명·실행 규칙·대상을 PATCH /skills/{id}로 저장하고(문서 스킬은 targets·result_mode 포함), 왼쪽 아래 '스킬 삭제'로 지운다.
 * 저장범위·커맨드명은 수정 API가 받지 않고, 스킬 종류·결과 방식은 지침을 다시 분류한 capability와 맞아야 해 읽기 전용으로 보여 준다.
 */
export function SkillDetailSheet({
  workspaceId,
  skill,
  onClose,
  onSubmit,
  onDelete
}: {
  workspaceId: string;
  skill: SkillResponse;
  onClose: () => void;
  onSubmit: (draft: SkillDetailDraft) => Promise<SkillAuthoringResult>;
  onDelete: () => Promise<void>;
}) {
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const [form, setForm] = useState<SkillDetailForm>(() => skillDetailForm(skill));
  const [touched, setTouched] = useState<ReadonlySet<SkillDetailField>>(new Set());
  const [issues, setIssues] = useState<unknown[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const errors = validateSkillDetailForm(form);
  const isBlocked = Object.keys(errors).length > 0;
  const visibleError = (field: SkillDetailField) => (touched.has(field) ? errors[field] : undefined);
  const isDocument = form.kind != null && isDocumentKind(form.kind);

  function update(patch: Partial<SkillDetailForm>) {
    setForm((current) => ({ ...current, ...patch }));
    // 내용을 고치면 이전 검토 지적은 더 이상 맞지 않는다.
    setIssues([]);
  }

  function touch(field: SkillDetailField) {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  }

  function toggleTarget(target: SkillTarget, checked: boolean) {
    update({
      targets: SKILL_TARGET_OPTIONS.map((option) => option.value).filter((value) =>
        value === target ? checked : form.targets.includes(value)
      )
    });
  }

  const saveMutation = useMutation({
    mutationFn: () => onSubmit(skillDetailDraft(form)),
    onSuccess: (result) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : [REVIEW_FALLBACK]);
        return;
      }
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || CLARIFY_FALLBACK);
        return;
      }
      onClose();
    }
  });

  const deleteMutation = useMutation({ mutationFn: onDelete, onSuccess: onClose });

  const referenceDocs = useReferenceDocuments(workspaceId);
  const [authorStatus, setAuthorStatus] = useState("");
  const authorMutation = useMutation({
    mutationFn: (mode: SkillAuthoringMode) =>
      authorSkill(workspaceId, skillAuthorRequest(skillDetailAuthorForm(form), mode, referenceDocs.selectedDocIds)),
    onMutate: () => setAuthorStatus(""),
    onSuccess: (result) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || CLARIFY_FALLBACK);
        return;
      }
      setForm((current) => applySkillDetailDraft(current, result));
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : [REVIEW_FALLBACK]);
        setAuthorStatus("안전 검토에서 고칠 부분이 발견되었습니다.");
        return;
      }
      setIssues([]);
      setAuthorStatus("AI가 다듬은 실행 규칙을 채웠습니다. 확인 후 저장해 주세요.");
    }
  });
  const authorError = authorMutation.error != null ? describeSkillAuthorError(authorMutation.error) : null;
  const isBusy = authorMutation.isPending || saveMutation.isPending || deleteMutation.isPending;

  function runAuthor(mode: SkillAuthoringMode) {
    // 실행 규칙이 AI 지시문이라, 비어 있으면 필드 오류를 보여 주고 보내지 않는다.
    touch("rules");
    if (form.rules.trim() !== "") authorMutation.mutate(mode);
  }

  function submit() {
    setTouched(new Set<SkillDetailField>(["description", "rules", "targets"]));
    if (!isBlocked) saveMutation.mutate();
  }

  const errorProps = (field: SkillDetailField) => {
    const message = visibleError(field);
    return {
      "aria-invalid": message != null,
      "aria-describedby": message != null ? fieldId(`${field}-error`) : undefined
    };
  };
  const errorText = (field: SkillDetailField) => {
    const message = visibleError(field);
    return message == null ? null : (
      <small id={fieldId(`${field}-error`)} className={styles.error} role="alert">
        {message}
      </small>
    );
  };

  function closeDeleteConfirm() {
    if (!deleteMutation.isPending) setIsDeleteConfirmOpen(false);
  }

  return (
    <SideSheet
      title="스킬 상세"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className={detailStyles["delete-button"]}
            disabled={isBusy}
            onClick={() => {
              deleteMutation.reset();
              setIsDeleteConfirmOpen(true);
            }}
          >
            스킬 삭제
          </button>
          <button type="button" className={styles["cancel-button"]} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className={styles["submit-button"]}
            disabled={isBusy}
            aria-disabled={isBlocked}
            onClick={submit}
          >
            {saveMutation.isPending ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div className={styles.hero}>
        <div className={cx(styles.heading, detailStyles.heading)}>
          <p className={styles.title}>스킬</p>
          <p className={styles.sub}>/{skill.slug}</p>
        </div>

        <div className={styles.fields}>
          {/* 저장범위 → scope_type (수정 API가 받지 않아 읽기 전용) */}
          <div className={styles.field}>
            <div className={styles["label-row"]}>
              <label className={styles.label} htmlFor={fieldId("scope")}>저장범위</label>
              <HelpTip label="저장범위" content={SCOPE_HELP} />
            </div>
            <div className={styles.menu}>
              <SelectBox
                id={fieldId("scope")}
                value={form.scope}
                options={SKILL_SCOPE_OPTIONS}
                disabled
                describedBy={fieldId("scope-hint")}
                onChange={() => undefined}
              />
              <p id={fieldId("scope-hint")} className={styles.hint}>
                {form.scope === "team"
                  ? "팀: 현재 워크스페이스에서 사용됩니다. 저장범위는 만든 뒤 바꿀 수 없어요."
                  : "저장범위는 만든 뒤 바꿀 수 없어요."}
              </p>
            </div>
          </div>

          {/* 커맨드명 → slug (읽기 전용) */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("command")}>커맨드명</label>
            <div className={cx(styles.input, styles["command-input"], detailStyles["read-only"])}>
              <span className={styles["command-prefix"]} aria-hidden>
                /
              </span>
              <input id={fieldId("command")} type="text" readOnly value={form.command} spellCheck={false} />
              <span className={styles.counter}>
                {form.command.length}/{SKILL_NAME_MAX}
              </span>
            </div>
          </div>

          {/* 설명 → description */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("description")}>설명</label>
            <input
              id={fieldId("description")}
              type="text"
              className={styles.input}
              value={form.description}
              {...errorProps("description")}
              onChange={(event) => update({ description: event.target.value })}
              onBlur={() => touch("description")}
            />
            {errorText("description")}
          </div>

          {/* 실행 규칙 → instructions_markdown (이전 형식의 "실행 대상" 절은 떼어 아래 대상으로 보여 준다) */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("rules")}>실행 규칙</label>
            <textarea
              id={fieldId("rules")}
              className={cx(styles.input, styles.textarea)}
              rows={6}
              value={form.rules}
              {...errorProps("rules")}
              onChange={(event) => update({ rules: event.target.value })}
              onBlur={() => touch("rules")}
            />
            {errorText("rules")}
            <SkillAuthorAssist
              selectedDocs={referenceDocs.selectedDocs}
              onOpenPicker={referenceDocs.openPicker}
              onRemoveDoc={referenceDocs.removeDoc}
              isBusy={isBusy}
              isAuthoring={authorMutation.isPending}
              status={authorStatus}
              idleHint="적은 실행 규칙과 참고 문서로 AI가 규칙을 다듬어 채워요."
              onAuthor={() => runAuthor("enhance")}
            />
          </div>

          {/* 스킬 종류·결과 방식 → capabilities (읽기 전용). 알 수 없는 capability면 표시하지 않는다. */}
          {form.kind != null && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={fieldId("kind")}>스킬 종류</label>
              <SelectBox id={fieldId("kind")} value={form.kind} options={SKILL_KIND_OPTIONS} disabled onChange={() => undefined} />
            </div>
          )}
          {isDocument && (
            <>
              <div className={styles.field}>
                <div className={styles["label-row"]}>
                  <label className={styles.label} htmlFor={fieldId("result")}>결과 방식</label>
                  <HelpTip label="결과 방식" content={RESULT_HELP} />
                </div>
                <div className={styles.menu}>
                  <SelectBox
                    id={fieldId("result")}
                    value={form.resultMode}
                    options={SKILL_RESULT_OPTIONS}
                    disabled
                    describedBy={fieldId("result-hint")}
                    onChange={() => undefined}
                  />
                  <p id={fieldId("result-hint")} className={styles.hint}>
                    스킬 종류와 결과 방식은 만든 뒤 바꿀 수 없어요.
                  </p>
                </div>
              </div>

              {/* 대상 → targets */}
              <fieldset className={styles.field} {...errorProps("targets")}>
                <legend className={cx(styles.label, styles.legend)}>대상</legend>
                <div className={styles.checks}>
                  {SKILL_TARGET_OPTIONS.map((option) => (
                    <label key={option.value} className={styles["check-row"]}>
                      <span className={styles.check}>
                        <input
                          type="checkbox"
                          checked={form.targets.includes(option.value)}
                          onChange={(event) => {
                            touch("targets");
                            toggleTarget(option.value, event.target.checked);
                          }}
                        />
                        <CheckMark />
                      </span>
                      <span className={styles["check-label"]}>{option.label}</span>
                    </label>
                  ))}
                </div>
                {errorText("targets")}
              </fieldset>
            </>
          )}

          <SkillSafetyIssues
            issues={issues}
            isBusy={isBusy}
            onRegenerate={() => runAuthor("regenerate")}
            onPreserve={() => runAuthor("preserve")}
          />

          {saveMutation.isError && (
            <p className={styles.error} role="alert">
              {getErrorMessage(saveMutation.error, "스킬 정의를 수정하지 못했습니다.")}
            </p>
          )}
        </div>
      </div>

      {isDeleteConfirmOpen && (
        <AlertModal
          titleId={fieldId("delete-title")}
          title="스킬을 삭제하시겠습니까?"
          description={`「/${skill.slug}」 스킬과 저장된 버전이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`}
          onClose={closeDeleteConfirm}
        >
          {deleteMutation.isError && (
            <p className={styles.error} role="alert">
              {getErrorMessage(deleteMutation.error, "스킬을 삭제하지 못했습니다.")}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="modal-cancel-button"
              autoFocus
              disabled={deleteMutation.isPending}
              onClick={closeDeleteConfirm}
            >
              취소
            </button>
            <button
              type="button"
              className="modal-delete-button"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "삭제 중…" : "삭제"}
            </button>
          </div>
        </AlertModal>
      )}

      {authorError && (
        <AlertModal
          titleId={fieldId("author-error-title")}
          title={authorError.title}
          description={authorError.description}
          onClose={() => authorMutation.reset()}
        >
          <button type="button" className="modal-confirm-button" onClick={() => authorMutation.reset()}>
            확인
          </button>
        </AlertModal>
      )}

      {referenceDocs.pickerModal}

      {question && (
        <AlertModal
          titleId={fieldId("clarify-title")}
          title="실행 규칙을 조금 더 구체적으로 적어 주세요."
          description={question}
          onClose={() => setQuestion(null)}
        >
          <button type="button" className="modal-confirm-button" onClick={() => setQuestion(null)}>
            확인
          </button>
        </AlertModal>
      )}
    </SideSheet>
  );
}
