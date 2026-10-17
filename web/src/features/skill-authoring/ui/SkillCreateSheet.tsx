"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authorSkill, fetchSkills, publishSkill } from "@/entities/skill";
import { SideSheet } from "@/shared/ui/modal/SideSheet";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { describeSkillAuthorError, skillAuthoringOutcome } from "../lib/skillAuthoring";
import {
  applySkillDraft,
  INITIAL_SKILL_CREATE_FORM,
  skillAuthorRequest,
  type SkillAuthoringMode,
  isDocumentKind,
  SKILL_KIND_OPTIONS,
  SKILL_NAME_MAX,
  SKILL_RESULT_OPTIONS,
  SKILL_SCOPE_OPTIONS,
  SKILL_TARGET_OPTIONS,
  skillPublishRequest,
  validateSkillCreateForm,
  type SkillCreateField,
  type SkillCreateForm,
  type SkillTarget
} from "../lib/skillCreateForm";
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

/**
 * 스킬 만들기 시트 (Figma 1671:14199). 입력값을 그대로 POST /skills/author/publish로 게시한다.
 * 게시 API가 같은 안전 검토를 거쳐, 위험 표현이 있으면 저장하지 않고 status "blocked"와 issues를 돌려준다.
 * 'AI로 작성·보강'은 실행 규칙(+참고 문서)을 POST /skills/author로 보내 받은 초안을 시트에 채운다.
 */
export function SkillCreateSheet({
  workspaceId,
  onClose,
  onPublished
}: {
  workspaceId: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const [form, setForm] = useState<SkillCreateForm>(INITIAL_SKILL_CREATE_FORM);
  const [touched, setTouched] = useState<ReadonlySet<SkillCreateField>>(new Set());
  const [issues, setIssues] = useState<unknown[]>([]);
  const [question, setQuestion] = useState<string | null>(null);

  // 기존 스킬 커맨드와 중복이면 미리 막는다 (서버도 게시 시점에 중복을 차단한다).
  const { data: existingSkills } = useQuery({
    queryKey: ["skills", workspaceId],
    queryFn: () => fetchSkills(workspaceId),
    staleTime: 60_000
  });
  const errors = validateSkillCreateForm(form, (existingSkills ?? []).map((skill) => skill.slug));
  const isBlocked = Object.keys(errors).length > 0;
  const visibleError = (field: SkillCreateField) => (touched.has(field) ? errors[field] : undefined);
  const isDocument = isDocumentKind(form.kind);

  function update(patch: Partial<SkillCreateForm>) {
    setForm((current) => ({ ...current, ...patch }));
    // 내용을 고치면 이전 검토 지적은 더 이상 맞지 않는다.
    setIssues([]);
  }

  function touch(field: SkillCreateField) {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  }

  function toggleTarget(target: SkillTarget, checked: boolean) {
    update({
      targets: SKILL_TARGET_OPTIONS.map((option) => option.value).filter((value) =>
        value === target ? checked : form.targets.includes(value)
      )
    });
  }

  const publishMutation = useMutation({
    mutationFn: () => publishSkill(workspaceId, skillPublishRequest(form)),
    onSuccess: (result) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "review") {
        // 위험 표현이 발견돼 저장되지 않았다. 지적을 보여 주고 규칙을 고치게 한다.
        setIssues(result.issues?.length ? result.issues : ["안전 검토에서 위험한 표현이 발견되었습니다."]);
        return;
      }
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || "무엇을 할지 조금 더 구체적으로 적어 주세요.");
        return;
      }
      onPublished();
      onClose();
    }
  });
  const publishError = publishMutation.error != null ? describeSkillAuthorError(publishMutation.error) : null;

  const referenceDocs = useReferenceDocuments(workspaceId);

  // AI 작성: enhance(보강, 기본) / preserve(원문 유지 재검토) / regenerate(차단 구간 제거 후 안전 재작성)
  const [authorStatus, setAuthorStatus] = useState("");
  const authorMutation = useMutation({
    mutationFn: (mode: SkillAuthoringMode) =>
      authorSkill(workspaceId, skillAuthorRequest(form, mode, referenceDocs.selectedDocIds)),
    onMutate: () => setAuthorStatus(""),
    onSuccess: (result) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "clarify") {
        // 초안 없이 되묻는 응답이다. 입력은 그대로 두고 질문을 알린다.
        setQuestion(result.question?.trim() || "무엇을 할지 조금 더 구체적으로 적어 주세요.");
        return;
      }
      setForm((current) => applySkillDraft(current, result));
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : ["안전 검토에서 위험한 표현이 발견되었습니다."]);
        setAuthorStatus("안전 검토에서 고칠 부분이 발견되었습니다.");
        return;
      }
      setIssues([]);
      setAuthorStatus("AI가 작성한 실행 규칙을 채웠습니다. 확인 후 스킬을 만들어 주세요.");
    }
  });
  const authorError = authorMutation.error != null ? describeSkillAuthorError(authorMutation.error) : null;
  const isRulesEmpty = form.rules.trim() === "";

  function runAuthor(mode: SkillAuthoringMode) {
    // 실행 규칙이 AI 지시문이라, 비어 있으면 필드 오류를 보여 주고 보내지 않는다.
    touch("rules");
    if (!isRulesEmpty) authorMutation.mutate(mode);
  }
  const isBusy = authorMutation.isPending || publishMutation.isPending;

  function submit() {
    // 비활성 버튼은 클릭을 받지 못하므로 aria-disabled로 두고, 누르면 오류가 있는 필드를 모두 표시한다.
    setTouched(new Set<SkillCreateField>(["command", "description", "rules"]));
    if (!isBlocked) publishMutation.mutate();
  }

  const errorProps = (field: SkillCreateField) => {
    const message = visibleError(field);
    return {
      "aria-invalid": message != null,
      "aria-describedby": message != null ? fieldId(`${field}-error`) : undefined
    };
  };
  const errorText = (field: SkillCreateField) => {
    const message = visibleError(field);
    return message == null ? null : (
      <small id={fieldId(`${field}-error`)} className={styles.error} role="alert">
        {message}
      </small>
    );
  };

  return (
    <SideSheet
      title="스킬 만들기"
      onClose={onClose}
      footer={
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
            {publishMutation.isPending ? "만드는 중…" : "스킬 만들기"}
          </button>
        </>
      }
    >
      <div className={styles.hero}>
        <div className={styles.heading}>
          <p className={styles.title}>새 스킬</p>
          <p className={styles.sub}>반복 작업을 안전한 실행 규칙으로 만들어 Fruition Agent에서 재사용합니다.</p>
        </div>

        <div className={styles.fields}>
          {/* 스킬 종류 → capability */}
          <div className={styles.field}>
            <div className={styles["label-row"]}>
              <label className={styles.label} htmlFor={fieldId("kind")}>스킬 종류</label>
              <HelpTip
                label="스킬 종류"
                content={
                  <>
                    문서 - 문서를 만들거나 고칩니다.
                    <br />
                    폴더 정리 - 폴더와 문서의 위치·이름을 정리합니다.
                    <br />
                    템플릿 - 정해진 양식으로 문서를 만듭니다.
                  </>
                }
              />
            </div>
            <SelectBox id={fieldId("kind")} value={form.kind} options={SKILL_KIND_OPTIONS} onChange={(kind) => update({ kind })} />
          </div>

          {/* 결과 방식 → 문서 capability(새 문서 / 현재 문서 수정 / 둘 다) */}
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
                disabled={!isDocument}
                onChange={(resultMode) => update({ resultMode })}
              />
              <p className={styles.hint}>
                {isDocument
                  ? "'상황에 맞게'는 대상이 애매하면 Agent가 되물어요."
                  : "결과 방식은 문서 스킬에서만 고를 수 있어요."}
              </p>
            </div>
          </div>

          {/* 대상 → 백엔드 필드가 없어 지침의 '실행 대상' 절로 합친다 */}
          <fieldset className={styles.field} disabled={!isDocument}>
            <legend className={cx(styles.label, styles.legend)}>대상</legend>
            <div className={styles.checks}>
              {SKILL_TARGET_OPTIONS.map((option) => (
                <label key={option.value} className={styles["check-row"]}>
                  <span className={styles.check}>
                    <input
                      type="checkbox"
                      checked={form.targets.includes(option.value)}
                      onChange={(event) => toggleTarget(option.value, event.target.checked)}
                    />
                    <CheckMark />
                  </span>
                  <span className={styles["check-label"]}>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 저장범위 → scope_type */}
          <div className={styles.field}>
            <div className={styles["label-row"]}>
              <label className={styles.label} htmlFor={fieldId("scope")}>저장범위</label>
              <HelpTip label="저장범위" content={SCOPE_HELP} />
            </div>
            <div className={styles.menu}>
              <SelectBox id={fieldId("scope")} value={form.scope} options={SKILL_SCOPE_OPTIONS} onChange={(scope) => update({ scope })} />
              {/* 팀 스킬은 지금 있는 워크스페이스 한 곳에만 게시한다(publish를 호출한 워크스페이스에 귀속). */}
              {form.scope === "team" && <p className={styles.hint}>팀: 현재 워크스페이스에서 사용됩니다.</p>}
            </div>
          </div>

          {/* 커맨드명 → name */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("command")}>커맨드명</label>
            <div className={cx(styles.input, styles["command-input"])}>
              <span className={styles["command-prefix"]} aria-hidden>
                /
              </span>
              <input
                id={fieldId("command")}
                type="text"
                maxLength={SKILL_NAME_MAX}
                placeholder="research-summary"
                autoComplete="off"
                spellCheck={false}
                value={form.command}
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
            <label className={styles.label} htmlFor={fieldId("description")}>설명</label>
            <input
              id={fieldId("description")}
              type="text"
              className={styles.input}
              placeholder="연구 문서의 개요를 핵심 문장 3개로 정리합니다."
              value={form.description}
              {...errorProps("description")}
              onChange={(event) => update({ description: event.target.value })}
              onBlur={() => touch("description")}
            />
            {errorText("description")}
          </div>

          {/* 실행 규칙 → instructions_markdown */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("rules")}>실행 규칙</label>
            <textarea
              id={fieldId("rules")}
              className={cx(styles.input, styles.textarea)}
              rows={6}
              placeholder={"'연구 개요' 섹션만 고친다. 다른 섹션은 바꾸지 않는다.\n원문에 없는 수치나 사실은 추가하지 않는다."}
              value={form.rules}
              {...errorProps("rules")}
              onChange={(event) => update({ rules: event.target.value })}
              onBlur={() => touch("rules")}
            />
            {errorText("rules")}

            {/* 참고 문서 + AI 작성: 실행 규칙을 AI 지시문으로 보내 초안을 받아 채운다 (POST /skills/author) */}
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

          <SkillSafetyIssues
            issues={issues}
            isBusy={isBusy}
            onRegenerate={() => runAuthor("regenerate")}
            onPreserve={() => runAuthor("preserve")}
          />
        </div>
      </div>

      {publishError && (
        <AlertModal
          titleId={fieldId("publish-error-title")}
          title={publishError.title}
          description={publishError.description}
          onClose={() => publishMutation.reset()}
        >
          <button type="button" className="modal-confirm-button" onClick={() => publishMutation.reset()}>
            확인
          </button>
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

      {/* 참고 문서 선택 — 네비게이션 검색과 동일한 중앙 모달 */}
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
