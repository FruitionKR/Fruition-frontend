"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authorSkill, fetchSkills, publishSkill } from "@/entities/skill";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import lightningSmallIcon from "@/shared/assets/svg/common/lightning-small.svg";
import { describeSkillAuthorError, skillAuthoringOutcome } from "../lib/skillAuthoring";
import {
  applySkillDraft,
  INITIAL_SKILL_CREATE_FORM,
  isDocumentKind,
  SKILL_NAME_MAX,
  SKILL_RESULT_OPTIONS,
  SKILL_SCOPE_OPTIONS,
  SKILL_TARGET_OPTIONS,
  skillAuthorRequest,
  skillCreateFormFromRequest,
  rulesPlaceholderHint,
  skillPublishRequest,
  validateSkillCreateForm,
  type SkillAuthoringMode,
  type SkillCreateField,
  type SkillCreateForm,
  type SkillTarget
} from "../lib/skillCreateForm";
import {
  HelpTip,
  RESULT_HELP,
  SCOPE_HELP,
  SegmentedControl,
  SkillAuthorAssist,
  SkillEditorLayout,
  SkillKindCards,
  SkillSafetyIssues,
  TargetChecks,
  useReferenceDocuments
} from "./SkillFormParts";
import { SkillTestRunCard } from "./SkillTestRunCard";
import styles from "./SkillEditor.module.css";

const CLARIFY_FALLBACK = "무엇을 할지 조금 더 구체적으로 적어 주세요.";
const REVIEW_FALLBACK = "안전 검토에서 위험한 표현이 발견되었습니다.";

/**
 * 새 스킬 편집 탭 (디자인 '② 새 스킬 탭 · 종류 2개 + 결과 방식 + 테스트 실행').
 * 입력값을 그대로 POST /skills/author/publish로 게시한다. 게시 API가 같은 안전 검토를 거쳐,
 * 위험 표현이 있으면 저장하지 않고 status "blocked"와 issues를 돌려준다.
 * 'AI로 작성·보강'은 실행 규칙(+참고 문서)을 POST /skills/author로 보내 받은 초안을 채운다.
 * 오른쪽 열 '테스트 실행'은 지금 입력값을 문서 하나에 저장 없이 적용해 본다.
 * prefillRequest가 있으면 Agent 대화의 요청으로 실행 규칙을 채우고 안내 배너를 보여 준다.
 */
export function SkillCreateEditor({
  workspaceId,
  prefillRequest,
  onClose,
  onShowList,
  onPublished
}: {
  workspaceId: string;
  prefillRequest?: string;
  onClose: () => void;
  onShowList: () => void;
  onPublished: () => void;
}) {
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const prefill = prefillRequest?.trim() ?? "";
  const [form, setForm] = useState<SkillCreateForm>(() =>
    prefill !== "" ? skillCreateFormFromRequest(prefill) : INITIAL_SKILL_CREATE_FORM
  );
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
  const rulesHint = rulesPlaceholderHint(form.kind);

  function update(patch: Partial<SkillCreateForm>) {
    setForm((current) => ({ ...current, ...patch }));
    // 내용을 고치면 이전 검토 지적은 더 이상 맞지 않는다.
    setIssues([]);
  }

  function touch(field: SkillCreateField) {
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

  const publishMutation = useMutation({
    mutationFn: () => publishSkill(workspaceId, skillPublishRequest(form)),
    onSuccess: (result) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "review") {
        // 위험 표현이 발견돼 저장되지 않았다. 지적을 보여 주고 규칙을 고치게 한다.
        setIssues(result.issues?.length ? result.issues : [REVIEW_FALLBACK]);
        return;
      }
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || CLARIFY_FALLBACK);
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
        setQuestion(result.question?.trim() || CLARIFY_FALLBACK);
        return;
      }
      setForm((current) => applySkillDraft(current, result));
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : [REVIEW_FALLBACK]);
        setAuthorStatus("안전 검토에서 고칠 부분이 발견되었습니다.");
        return;
      }
      setIssues([]);
      setAuthorStatus("AI가 작성한 실행 규칙을 채웠습니다. 확인 후 저장해 주세요.");
    }
  });
  const authorError = authorMutation.error != null ? describeSkillAuthorError(authorMutation.error) : null;

  function runAuthor(mode: SkillAuthoringMode) {
    // 실행 규칙이 AI 지시문이라, 비어 있으면 필드 오류를 보여 주고 보내지 않는다.
    touch("rules");
    if (form.rules.trim() !== "") authorMutation.mutate(mode);
  }
  const isBusy = authorMutation.isPending || publishMutation.isPending;

  function submit() {
    // 비활성 버튼은 클릭을 받지 못하므로 aria-disabled로 두고, 누르면 오류가 있는 필드를 모두 표시한다.
    setTouched(new Set<SkillCreateField>(["command", "description", "rules", "targets"]));
    if (!isBlocked) publishMutation.mutate();
  }

  const errorProps = (field: SkillCreateField, hintId?: string) => {
    const message = visibleError(field);
    return {
      "aria-invalid": message != null,
      "aria-describedby": message != null ? fieldId(`${field}-error`) : hintId
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
    <SkillEditorLayout
      titleId={fieldId("title")}
      title="새 스킬"
      onShowList={onShowList}
      aside={<SkillTestRunCard workspaceId={workspaceId} form={form} />}
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
            {publishMutation.isPending ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      {prefill !== "" && (
        <p className={styles.banner} role="note">
          <SvgIcon src={lightningSmallIcon} className={styles["banner-icon"]} />
          <span>Agent 대화의 요청 “{prefill}”로 채웠어요. 필요한 부분만 고치세요.</span>
        </p>
      )}

      <div className={styles.fields}>
        {/* 스킬 종류 → capability */}
        <div className={styles.field}>
          <span id={fieldId("kind-label")} className={styles.label}>
            스킬 종류
          </span>
          <SkillKindCards
            name={fieldId("kind")}
            labelledBy={fieldId("kind-label")}
            value={form.kind}
            onChange={(kind) => update({ kind })}
          />

          {/* 문서 스킬만: 결과 방식 → capability + result_mode, 대상 → targets */}
          {isDocument && (
            <div className={styles["sub-panel"]}>
              <div className={styles.field}>
                <div className={styles["label-row"]}>
                  <span id={fieldId("result-label")} className={styles.label}>
                    결과 방식
                  </span>
                  <HelpTip label="결과 방식" content={RESULT_HELP} />
                </div>
                <div className={styles.menu}>
                  <SegmentedControl
                    name={fieldId("result")}
                    labelledBy={fieldId("result-label")}
                    describedBy={fieldId("result-hint")}
                    value={form.resultMode}
                    options={SKILL_RESULT_OPTIONS}
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
            </div>
          )}
        </div>

        <div className={styles["field-row"]}>
          {/* 커맨드 → name */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId("command")}>
              커맨드
            </label>
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
                {...errorProps("command", fieldId("command-hint"))}
                onChange={(event) => update({ command: event.target.value })}
                onBlur={() => touch("command")}
              />
              <span className={styles.counter}>
                {form.command.length}/{SKILL_NAME_MAX}
              </span>
            </div>
            {errorText("command") ?? (
              <p id={fieldId("command-hint")} className={styles.hint}>
                Agent 입력창에서 / 를 치면 이 이름으로 찾습니다.
              </p>
            )}
          </div>

          {/* 저장범위 → scope_type */}
          <div className={styles.field}>
            <div className={styles["label-row"]}>
              <span id={fieldId("scope-label")} className={styles.label}>
                저장범위
              </span>
              <HelpTip label="저장범위" content={SCOPE_HELP} />
            </div>
            <div className={styles.menu}>
              <SegmentedControl
                name={fieldId("scope")}
                labelledBy={fieldId("scope-label")}
                value={form.scope}
                options={SKILL_SCOPE_OPTIONS}
                onChange={(scope) => update({ scope })}
              />
              {/* 팀 스킬은 지금 있는 워크스페이스 한 곳에만 게시한다(publish를 호출한 워크스페이스에 귀속). */}
              {form.scope === "team" && <p className={styles.hint}>팀: 현재 워크스페이스에서 사용됩니다.</p>}
            </div>
          </div>
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
          <label className={styles.label} htmlFor={fieldId("rules")}>
            실행 규칙
          </label>
          <textarea
            id={fieldId("rules")}
            className={cx(styles.input, styles.textarea)}
            rows={8}
            placeholder={"'연구 개요' 섹션만 고친다. 다른 섹션은 바꾸지 않는다.\n원문에 없는 수치나 사실은 추가하지 않는다."}
            value={form.rules}
            {...errorProps("rules", rulesHint != null ? fieldId("rules-hint") : undefined)}
            onChange={(event) => update({ rules: event.target.value })}
            onBlur={() => touch("rules")}
          />
          {errorText("rules") ?? (rulesHint != null && (
            <p id={fieldId("rules-hint")} className={styles.hint}>
              {rulesHint}
            </p>
          ))}

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
    </SkillEditorLayout>
  );
}
