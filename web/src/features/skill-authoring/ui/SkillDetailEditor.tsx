"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchSkills, type SkillResponse } from "@/entities/skill";
import type { SkillAuthoringResult } from "@/entities/skill/model/skill";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { skillAuthoringOutcome } from "../lib/skillAuthoring";
import { SKILL_NAME_MAX, SKILL_SCOPE_OPTIONS } from "../lib/skillCreateForm";
import {
  skillDetailAuthorForm,
  skillDetailDraft,
  skillDetailForm,
  validateSkillDetailForm,
  type SkillDetailDraft,
  type SkillDetailField,
  type SkillDetailForm
} from "../lib/skillDetailForm";
import { HelpTip, SCOPE_HELP, SelectBox, SkillSafetyIssues } from "./SkillFormParts";
import { SkillSheet } from "./SkillSheet";
import { SkillTestRunCard } from "./SkillTestRunCard";
import styles from "./SkillEditor.module.css";
import detailStyles from "./SkillDetailEditor.module.css";

const CLARIFY_FALLBACK = "무엇을 할지 조금 더 구체적으로 적어 주세요.";
const REVIEW_FALLBACK = "안전 검토에서 위험한 표현이 발견되었습니다.";

/**
 * 스킬 상세 시트 (Figma 1708:3848). 목록 행 클릭·더보기 '수정'으로 연다. 스킬 만들기와 같은 시트를 쓰지만 필드는 시안대로
 * 저장범위 · 커맨드명 · 설명 · 실행 규칙만 둔다(대상·스킬 종류·결과 방식·AI 작성·참고 문서 없음).
 * 커맨드명(name → slug)·설명·실행 규칙을 PATCH /skills/{id}로 저장하고, '스킬 삭제'로 지운다.
 * 저장범위는 수정 API가 받지 않아(scope_type은 바꿀 수 없다) 읽기 전용이다.
 */
export function SkillDetailEditor({
  workspaceId,
  skill,
  host,
  testRunTarget,
  onClose,
  onSubmit,
  onDelete
}: {
  workspaceId: string;
  skill: SkillResponse;
  /** 시트를 그릴 요소(main.workspace). 없으면 제자리에 그린다. */
  host: HTMLElement | null;
  /** 채팅 패널의 테스트 실행 자리. 없으면 시트 본문 끝에 둔다. */
  testRunTarget: HTMLElement | null;
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

  // 다른 스킬 커맨드와 중복이면 미리 막는다(서버도 409로 막는다). 만들기 시트와 같은 쿼리 키를 쓴다.
  const { data: existingSkills } = useQuery({
    queryKey: ["skills", workspaceId],
    queryFn: () => fetchSkills(workspaceId),
    staleTime: 60_000
  });
  const otherSlugs = (existingSkills ?? []).filter((item) => item.id !== skill.id).map((item) => item.slug);
  const errors = validateSkillDetailForm(form, otherSlugs);
  const isBlocked = Object.keys(errors).length > 0;
  const visibleError = (field: SkillDetailField) => (touched.has(field) ? errors[field] : undefined);

  function update(patch: Partial<SkillDetailForm>) {
    setForm((current) => ({ ...current, ...patch }));
    // 내용을 고치면 이전 검토 지적은 더 이상 맞지 않는다.
    setIssues([]);
  }

  function touch(field: SkillDetailField) {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
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

  const isBusy = saveMutation.isPending || deleteMutation.isPending;

  function submit() {
    setTouched(new Set<SkillDetailField>(["command", "description", "rules"]));
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

  // 테스트 실행은 종류를 알아야 capability를 정할 수 있다. 알 수 없는 capability면 테스트 실행을 두지 않는다.
  const testRunForm = form.kind != null ? skillDetailAuthorForm(form) : null;
  const testRun = testRunForm != null
    ? <SkillTestRunCard workspaceId={workspaceId} form={testRunForm} label={`스킬 수정 · /${skill.slug}`} />
    : undefined;

  return (
    <SkillSheet
      host={host}
      titleId={fieldId("title")}
      headerLabel="스킬 상세"
      title="스킬"
      subtitle={`/${skill.slug}`}
      testRun={testRun}
      testRunTarget={testRunTarget}
      isClosable={!saveMutation.isPending && !deleteMutation.isPending}
      onClose={onClose}
      footerStart={
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
      }
      actions={
        <>
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
      {/* Figma 1708:3848: 저장범위 · 커맨드명 · 설명 · 실행 규칙 */}
      <div className={styles.fields}>
        {/* 저장범위 → scope_type (수정 API가 받지 않아 읽기 전용) */}
        <div className={styles.field}>
          <div className={styles["label-row"]}>
            <label className={styles.label} htmlFor={fieldId("scope")}>
              저장범위
            </label>
            <HelpTip label="저장범위" content={SCOPE_HELP} />
          </div>
          <SelectBox id={fieldId("scope")} value={form.scope} options={SKILL_SCOPE_OPTIONS} disabled onChange={() => undefined} />
        </div>

        {/* 커맨드명 → name (PATCH가 이 값으로 slug를 바꾼다) */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("command")}>
            커맨드명
          </label>
          <div className={cx(styles.input, styles["command-input"])}>
            <span className={styles["command-prefix"]} aria-hidden>
              /
            </span>
            <input
              id={fieldId("command")}
              type="text"
              maxLength={SKILL_NAME_MAX}
              value={form.command}
              autoComplete="off"
              spellCheck={false}
              {...errorProps("command")}
              onChange={(event) => update({ command: event.target.value })}
              onBlur={() => touch("command")}
            />
            <span className={styles.counter}>
              {form.command.length}/{SKILL_NAME_MAX}
            </span>
          </div>
          {errorText("command")}
        </div>

        {/* 설명 → description */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("description")}>
            설명
          </label>
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

        {/* 실행 규칙 → instructions_markdown (이전 형식의 "실행 대상" 절은 떼어 위 대상으로 보여 준다) */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("rules")}>
            실행 규칙
          </label>
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
        </div>

        <SkillSafetyIssues issues={issues} isBusy={isBusy} />

        {saveMutation.isError && (
          <p className={styles.error} role="alert">
            {getErrorMessage(saveMutation.error, "스킬 정의를 수정하지 못했습니다.")}
          </p>
        )}
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
    </SkillSheet>
  );
}
