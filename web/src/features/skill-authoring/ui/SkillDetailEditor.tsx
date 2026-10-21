"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchSkills, type SkillResponse } from "@/entities/skill";
import type { SkillAuthoringResult } from "@/entities/skill/model/skill";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { getErrorMessage } from "@/shared/lib/apiErrors";
import { describeSkillSaveError, isSkillFormDirty, skillAuthoringOutcome } from "../lib/skillAuthoring";
import {
  isDocumentKind,
  SKILL_KIND_CARDS,
  SKILL_KIND_LABELS,
  SKILL_NAME_MAX,
  SKILL_RESULT_OPTIONS,
  SKILL_SCOPE_OPTIONS,
  SKILL_TARGET_OPTIONS,
  type SkillKind,
  type SkillTarget
} from "../lib/skillCreateForm";
import {
  requiresSourceDrift,
  savedSkillKind,
  savedSkillKindFromResult,
  showsDetailSourceField,
  skillDetailAuthorForm,
  skillDetailDraft,
  skillDetailForm,
  validateSkillDetailForm,
  type SavedSkillKind,
  type SkillDetailDraft,
  type SkillDetailField,
  type SkillDetailForm
} from "../lib/skillDetailForm";
import { HelpTip, KIND_HELP, RESULT_HELP, SCOPE_HELP, SelectBox, SkillSafetyIssues, SourceField, TargetChecks } from "./SkillFormParts";
import { SkillSheet, useSkillSheetClose } from "./SkillSheet";
import { SkillTestRunCard } from "./SkillTestRunCard";
import styles from "./SkillEditor.module.css";
import detailStyles from "./SkillDetailEditor.module.css";

const CLARIFY_FALLBACK = "무엇을 할지 조금 더 구체적으로 적어 주세요.";
const REVIEW_FALLBACK = "안전 검토에서 위험한 표현이 발견되었습니다.";

/** 종류를 알 수 없는 스킬(capabilities 해석 불가)을 열었을 때 스킬 종류 선택 상자에 보이는 문구 */
const UNKNOWN_KIND_PLACEHOLDER = "알 수 없음";

/**
 * 스킬 종류 선택지. 만들기 시트와 같이 문서·폴더 정리를 고르고, 템플릿은 새로 고를 수 없어 저장된 종류가 템플릿일 때만 둔다.
 */
function kindOptions(savedKind: SkillKind | null): ReadonlyArray<{ value: SkillKind; label: string }> {
  const options: Array<{ value: SkillKind; label: string }> = SKILL_KIND_CARDS.map(({ value, label }) => ({ value, label }));
  if (savedKind === "template") options.push({ value: "template", label: SKILL_KIND_LABELS.template });
  return options;
}

/**
 * 스킬 상세 시트 (Figma 1708:3848). 목록 행(커맨드명) 클릭으로 연다. 스킬 만들기와 같은 시트를 쓴다.
 * 시안의 저장범위 · 커맨드명 · 설명 · 실행 규칙 위에, 만들기 시트(Figma 1671:14736)와 같은 순서·부품으로
 * 스킬 종류 · 결과 방식 · 대상 · (원문 문서)를 둔다(시안 밖 추가 필드, AI 작성·참고 문서는 없음).
 * 커맨드명(name → slug)·설명·실행 규칙과 종류·결과 방식·대상을 PATCH /skills/{id}로 저장하고, '스킬 삭제'로 지운다.
 * 종류·결과 방식이 저장된 값과 다르면 capabilities를 함께 보낸다(skillDetailDraft). 저장범위는 수정 API가 받지 않아 읽기 전용이다.
 * 고친 내용은 '저장'을 눌러야 반영된다(자동 저장 없음). 테스트 실행은 저장 전 입력값(종류 포함)으로 하고, 고친 채 닫으면 버릴지 묻는다.
 * 원문 문서는 새 문서를 만들 수 있는 문서 스킬이고 서버가 requires_source를 줄 때만 보인다.
 * 필드가 보이면 화면 값을 그대로 보내고, 보내지 않은 저장에서 AI가 값을 바꾸면 시트를 열어 둔 채 알리고 되돌릴 수 있게 한다.
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
  // 저장한 뒤 AI가 원문 문서를 바꿔 시트를 열어 둘 때는 저장된 값을 새 기준으로 삼는다.
  const [initialForm, setInitialForm] = useState<SkillDetailForm>(() => skillDetailForm(skill));
  const [form, setForm] = useState<SkillDetailForm>(initialForm);
  // 저장 때 종류·결과 방식이 바뀌었는지 비교할 서버 값. 저장한 뒤 시트를 열어 두면 응답 값으로 바꾼다.
  const [saved, setSaved] = useState<SavedSkillKind>(() => savedSkillKind(skill));
  const sheetClose = useSkillSheetClose(onClose, isSkillFormDirty(initialForm, form));
  const [touched, setTouched] = useState<ReadonlySet<SkillDetailField>>(new Set());
  const [issues, setIssues] = useState<unknown[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  // 원문 문서를 보내지 않은 저장에서 AI가 값을 바꿨을 때 알림. 이전 값(from)으로 되돌려 다시 저장할 수 있다.
  const [sourceNote, setSourceNote] = useState<{ from: boolean; to: boolean } | null>(null);

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

  function toggleTarget(target: SkillTarget, checked: boolean) {
    touch("targets");
    update({
      targets: SKILL_TARGET_OPTIONS.map((option) => option.value).filter((value) =>
        value === target ? checked : form.targets.includes(value)
      )
    });
  }

  const saveMutation = useMutation({
    mutationFn: (draft: SkillDetailDraft) => onSubmit(draft),
    onSuccess: (result, draft) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : [REVIEW_FALLBACK]);
        return;
      }
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || CLARIFY_FALLBACK);
        return;
      }
      const sourceDrift = requiresSourceDrift(initialForm.requiresSource, draft.requires_source, result);
      if (sourceDrift != null) {
        // 변경은 저장됐다. 저장된 값을 새 기준으로 두고, AI가 바꾼 값을 보여 준 채 시트를 열어 둔다.
        const savedForm = { ...form, requiresSource: sourceDrift.to };
        setInitialForm(savedForm);
        setForm(savedForm);
        setSaved(savedSkillKindFromResult(result));
        setSourceNote(sourceDrift);
        return;
      }
      sheetClose.close();
    }
  });

  const deleteMutation = useMutation({ mutationFn: onDelete, onSuccess: sheetClose.close });

  const isBusy = saveMutation.isPending || deleteMutation.isPending;

  function submit() {
    setTouched(new Set<SkillDetailField>(["command", "description", "rules", "targets"]));
    if (!isBlocked) saveMutation.mutate(skillDetailDraft(form, saved));
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
      isLeaving={sheetClose.isLeaving}
      discardConfirm={sheetClose.discardConfirm}
      onClose={sheetClose.requestClose}
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
          <button type="button" className={styles["cancel-button"]} onClick={sheetClose.requestClose}>
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
      {/* 만들기 시트(Figma 1671:14736)와 같은 순서: 종류 · 결과 방식 · 대상 · (원문 문서) + Figma 1708:3848의 저장범위 · 커맨드명 · 설명 · 실행 규칙 */}
      <div className={styles.fields}>
        {/* 스킬 종류 → capabilities (저장된 값과 다르면 보낸다) */}
        <div className={styles.field}>
          <div className={styles["label-row"]}>
            <label className={styles.label} htmlFor={fieldId("kind")}>
              스킬 종류
            </label>
            <HelpTip label="스킬 종류" content={KIND_HELP} />
          </div>
          <SelectBox
            id={fieldId("kind")}
            value={form.kind}
            options={kindOptions(initialForm.kind)}
            placeholder={UNKNOWN_KIND_PLACEHOLDER}
            onChange={(kind) => update({ kind })}
          />
        </div>

        {/* 문서 스킬만: 결과 방식 → capabilities + result_mode, 대상 → targets */}
        {form.kind != null && isDocumentKind(form.kind) && (
          <>
            <div className={styles.field}>
              <div className={styles["label-row"]}>
                <label className={styles.label} htmlFor={fieldId("result")}>
                  결과 방식
                </label>
                <HelpTip label="결과 방식" content={RESULT_HELP} />
              </div>
              <div className={styles.menu}>
                <SelectBox
                  id={fieldId("result")}
                  value={form.resultMode}
                  options={SKILL_RESULT_OPTIONS}
                  describedBy={fieldId("result-hint")}
                  onChange={(resultMode) => update({ resultMode })}
                />
                <p id={fieldId("result-hint")} className={styles.hint}>
                  &apos;상황에 맞게&apos;는 대상이 애매하면 Agent가 되물어요.
                </p>
              </div>
            </div>

            <fieldset className={styles.field} {...errorProps("targets")}>
              <legend className={cx(styles.label, styles.legend)}>대상</legend>
              <TargetChecks targets={form.targets} onToggle={toggleTarget} />
              {errorText("targets")}
            </fieldset>
          </>
        )}

        {/* 원문 문서 → requires_source. 서버 값이 있고 새 문서를 만들 수 있는 문서 스킬일 때만 보인다. 보이면 화면 값을 그대로 보낸다. */}
        {showsDetailSourceField(form) && (
          <SourceField
            id={fieldId("source")}
            value={form.requiresSource}
            note={sourceNote}
            onChange={(requiresSource) => update({ requiresSource })}
            onUndo={() => {
              if (sourceNote) update({ requiresSource: sourceNote.from });
              setSourceNote(null);
            }}
          />
        )}

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

        {/* 실행 규칙 → instructions_markdown (이전 형식의 "실행 대상" 절은 떼어 위 대상 필드로 보여 준다) */}
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
            {describeSkillSaveError(saveMutation.error, "스킬 정의를 수정하지 못했습니다.")}
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
