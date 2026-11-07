"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { authorSkill, fetchSkills, publishSkill } from "@/entities/skill";
import { useUserPreferences } from "@/entities/user";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import lightningSmallIcon from "@/shared/assets/svg/common/lightning-small.svg";
import { describeSkillAuthorError, isSkillFormDirty, shouldAutoPublishSkillDraft, skillAuthoringOutcome } from "../lib/skillAuthoring";
import {
  applyReviewedSkillDraft,
  applySkillDraft,
  draftResultModeChange,
  draftSourceChange,
  INITIAL_SKILL_CREATE_FORM,
  isDocumentKind,
  SKILL_NAME_MAX,
  SKILL_TARGETS,
  skillAuthorRequest,
  skillCreateFormFromRequest,
  rulesPlaceholderHint,
  showsSourceField,
  skillPublishRequest,
  skillFieldErrorText,
  skillResultModeLabel,
  validateSkillCreateForm,
  type SkillAuthoringMode,
  type SkillCreateField,
  type SkillCreateForm,
  type SkillResultMode,
  type SkillTarget
} from "../lib/skillCreateForm";
import {
  HelpTip,
  KindHelp,
  ResultHelp,
  ScopeHelp,
  SelectBox,
  SkillAuthorAssist,
  SkillSafetyIssues,
  SourceField,
  TargetChecks,
  useReferenceDocuments,
  useSkillOptions
} from "./SkillFormParts";
import { SkillSheet, useSkillSheetClose } from "./SkillSheet";
import { SkillTestRunCard } from "./SkillTestRunCard";
import styles from "./SkillEditor.module.css";

/**
 * 스킬 만들기 시트 (Figma 1671:13573). 스킬 화면 위에 열리고, 테스트 실행은 채팅 패널(testRunTarget)에 둔다.
 * 입력값을 그대로 POST /skills/author/publish로 게시한다. 게시 API가 같은 안전 검토를 거쳐,
 * 위험 표현이 있으면 저장하지 않고 status "blocked"와 issues를 돌려준다.
 * 'AI로 작성·보강'은 실행 규칙(+참고 문서)을 POST /skills/author로 보내 받은 초안을 채운다.
 * '테스트 실행'은 지금 입력값을 문서 하나에 저장 없이 적용해 본다(채팅 패널이 없으면 시트 본문 끝).
 * prefillRequest가 있으면 Agent 대화의 요청으로 실행 규칙을 채우고 안내 배너를 보여 준다.
 */
export function SkillCreateEditor({
  workspaceId,
  prefillRequest,
  host,
  testRunTarget,
  onClose,
  onPublished
}: {
  workspaceId: string;
  prefillRequest?: string;
  /** 시트를 그릴 요소(main.workspace). 없으면 제자리에 그린다. */
  host: HTMLElement | null;
  /** 채팅 패널의 테스트 실행 자리. 없으면 시트 본문 끝에 둔다. */
  testRunTarget: HTMLElement | null;
  onClose: () => void;
  /** autoPublishedNotice: 설정에 따라 확인 없이 게시했을 때 목록 화면에 보일 안내. 알림 카드는 스킬 화면에 뜨지 않는다. */
  onPublished: (autoPublishedNotice: string | null) => void;
}) {
  const t = useTranslations("skills");
  const { kindOptions, resultOptions, scopeOptions } = useSkillOptions();
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const prefill = prefillRequest?.trim() ?? "";
  const { preferences } = useUserPreferences();
  const [initialForm] = useState<SkillCreateForm>(() =>
    prefill !== "" ? skillCreateFormFromRequest(prefill) : INITIAL_SKILL_CREATE_FORM
  );
  const [form, setForm] = useState<SkillCreateForm>(initialForm);
  // '스킬 만들기'를 누르기 전에는 게시하지 않는다. 고친 채 닫으면 버릴지 묻는다.
  const sheetClose = useSkillSheetClose(onClose, isSkillFormDirty(initialForm, form));
  const [touched, setTouched] = useState<ReadonlySet<SkillCreateField>>(new Set());
  const [issues, setIssues] = useState<unknown[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  // AI 초안이 고른 결과 방식으로 바꿨을 때 알림. 사용자가 고른 값(from)으로 되돌릴 수 있다.
  const [resultModeNote, setResultModeNote] = useState<{ from: SkillResultMode; to: SkillResultMode } | null>(null);
  // AI 초안이 원문 문서를 정했을 때 알림. 이전 값(고르지 않음이면 null)으로 되돌릴 수 있다.
  const [sourceNote, setSourceNote] = useState<{ from: boolean | null; to: boolean } | null>(null);

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
  const rulesHint = rulesPlaceholderHint(form.kind, t);

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
      targets: SKILL_TARGETS.filter((value) =>
        value === target ? checked : form.targets.includes(value)
      )
    });
  }

  const publishMutation = useMutation({
    mutationFn: ({ target }: { target: SkillCreateForm; isAutomatic: boolean }) => publishSkill(workspaceId, skillPublishRequest(target)),
    onSuccess: (result, { isAutomatic }) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "review") {
        // 위험 표현이 발견돼 저장되지 않았다. 지적을 보여 주고 규칙을 고치게 한다.
        setIssues(result.issues?.length ? result.issues : [t("review.issueFallback")]);
        return;
      }
      if (outcome === "clarify") {
        setQuestion(result.question?.trim() || t("review.clarifyFallback"));
        return;
      }
      onPublished(isAutomatic ? t("create.autoPublished") : null);
      sheetClose.close();
    }
  });
  const publishError = publishMutation.error != null ? describeSkillAuthorError(publishMutation.error, t) : null;

  const referenceDocs = useReferenceDocuments(workspaceId);

  // AI 작성: enhance(보강, 기본) / preserve(원문 유지 재검토) / regenerate(차단 구간 제거 후 안전 재작성)
  const [authorStatus, setAuthorStatus] = useState("");
  // 응답이 오기 전에 시트를 닫았는지 본다. 닫아도 진행 중인 요청의 onSuccess는 실행된다.
  const isEditorOpenRef = useRef(true);
  useEffect(() => {
    isEditorOpenRef.current = true;
    return () => {
      isEditorOpenRef.current = false;
    };
  }, []);
  const authorMutation = useMutation({
    mutationFn: ({ mode, source }: { mode: SkillAuthoringMode; source: SkillCreateForm }) =>
      authorSkill(workspaceId, skillAuthorRequest(source, mode, referenceDocs.selectedDocIds)),
    onMutate: () => setAuthorStatus(""),
    onSuccess: (result, { source }) => {
      const outcome = skillAuthoringOutcome(result);
      if (outcome === "clarify") {
        // 초안 없이 되묻는 응답이다. 입력은 그대로 두고 질문을 알린다.
        setQuestion(result.question?.trim() || t("review.clarifyFallback"));
        return;
      }
      const drafted = outcome === "review" ? applyReviewedSkillDraft(form, result) : applySkillDraft(form, result);
      setForm(drafted);
      setResultModeNote(draftResultModeChange(form, drafted));
      setSourceNote(draftSourceChange(form, drafted));
      if (outcome === "review") {
        setIssues(result.issues?.length ? result.issues : [t("review.issueFallback")]);
        setAuthorStatus(t("assist.reviewFound"));
        return;
      }
      setIssues([]);
      const shouldPublish = shouldAutoPublishSkillDraft({
        isEnabled: preferences.autoPublishSkillDrafts,
        outcome,
        validationErrorCount: existingSkills
          ? Object.keys(validateSkillCreateForm(drafted, existingSkills.map((skill) => skill.slug))).length
          : 0,
        isSkillListLoaded: Boolean(existingSkills),
        isFormUnchanged: form === source,
        isEditorOpen: isEditorOpenRef.current
      });
      if (shouldPublish) {
        publishMutation.mutate({ target: drafted, isAutomatic: true });
        return;
      }
      setAuthorStatus(t("assist.filled"));
    }
  });
  const authorError = authorMutation.error != null ? describeSkillAuthorError(authorMutation.error, t) : null;

  function runAuthor(mode: SkillAuthoringMode) {
    // 실행 규칙이 AI 지시문이라, 비어 있으면 필드 오류를 보여 주고 보내지 않는다.
    touch("rules");
    if (form.rules.trim() !== "") authorMutation.mutate({ mode, source: form });
  }
  const isBusy = authorMutation.isPending || publishMutation.isPending;

  function submit() {
    // 비활성 버튼은 클릭을 받지 못하므로 aria-disabled로 두고, 누르면 오류가 있는 필드를 모두 표시한다.
    setTouched(new Set<SkillCreateField>(["command", "description", "rules", "targets"]));
    if (!isBlocked) publishMutation.mutate({ target: form, isAutomatic: false });
  }

  const errorProps = (field: SkillCreateField, hintId?: string) => {
    const message = visibleError(field);
    return {
      "aria-invalid": message != null,
      "aria-describedby": message != null ? fieldId(`${field}-error`) : hintId
    };
  };
  const errorText = (field: SkillCreateField) => {
    const error = visibleError(field);
    return error == null ? null : (
      <small id={fieldId(`${field}-error`)} className={styles.error} role="alert">
        {skillFieldErrorText(error, t)}
      </small>
    );
  };

  const testRun = <SkillTestRunCard workspaceId={workspaceId} form={form} label={t("create.testRunLabel")} />;

  return (
    <SkillSheet
      host={host}
      titleId={fieldId("title")}
      headerLabel={t("create.headerLabel")}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      testRun={testRun}
      testRunTarget={testRunTarget}
      isClosable={!publishMutation.isPending}
      isLeaving={sheetClose.isLeaving}
      discardConfirm={sheetClose.discardConfirm}
      onClose={sheetClose.requestClose}
      actions={
        <>
          <button type="button" className={styles["cancel-button"]} onClick={sheetClose.requestClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={styles["submit-button"]}
            disabled={isBusy}
            aria-disabled={isBlocked}
            onClick={submit}
          >
            {publishMutation.isPending ? t("create.submitting") : t("create.submit")}
          </button>
        </>
      }
    >
      {prefill !== "" && (
        <p className={styles.banner} role="note">
          <SvgIcon src={lightningSmallIcon} className={styles["banner-icon"]} />
          <span>{t("create.prefilled", { request: prefill })}</span>
        </p>
      )}

      {/* 입력 순서·모양은 Figma 1671:14736: 종류 · 결과 방식 · 대상 · (원문 문서) · 저장범위 · 커맨드명 · 설명 · 실행 규칙 */}
      <div className={styles.fields}>
        {/* 스킬 종류 → capability */}
        <div className={styles.field}>
          <div className={styles["label-row"]}>
            <label className={styles.label} htmlFor={fieldId("kind")}>
              {t("form.kind")}
            </label>
            <HelpTip label={t("form.kind")} content={<KindHelp />} />
          </div>
          <SelectBox id={fieldId("kind")} value={form.kind} options={kindOptions} onChange={(kind) => update({ kind })} />
        </div>

        {/* 문서 스킬만: 결과 방식 → capability + result_mode, 대상 → targets */}
        {isDocument && (
          <>
            <div className={styles.field}>
              <div className={styles["label-row"]}>
                <label className={styles.label} htmlFor={fieldId("result")}>
                  {t("form.result")}
                </label>
                <HelpTip label={t("form.result")} content={<ResultHelp />} />
              </div>
              <div className={styles.menu}>
                <SelectBox
                  id={fieldId("result")}
                  value={form.resultMode}
                  options={resultOptions}
                  describedBy={fieldId("result-hint")}
                  onChange={(resultMode) => {
                    setResultModeNote(null);
                    update({ resultMode });
                  }}
                />
                <p id={fieldId("result-hint")} className={styles.hint}>
                  {t("form.resultHint")}
                </p>
                {resultModeNote && form.resultMode === resultModeNote.to && (
                  <p className={styles["result-note"]} role="status">
                    <span>{t("form.resultNote", { mode: skillResultModeLabel(resultModeNote.to, t) })}</span>
                    <button
                      type="button"
                      className={styles["result-note-undo"]}
                      onClick={() => {
                        update({ resultMode: resultModeNote.from });
                        setResultModeNote(null);
                      }}
                    >
                      {t("form.resultUndo", { mode: skillResultModeLabel(resultModeNote.from, t) })}
                    </button>
                  </p>
                )}
              </div>
            </div>

            <fieldset className={styles.field} {...errorProps("targets")}>
              <legend className={cx(styles.label, styles.legend)}>{t("form.targets")}</legend>
              <TargetChecks targets={form.targets} onToggle={toggleTarget} />
              {errorText("targets")}
            </fieldset>
          </>
        )}

        {/* 새 문서를 만들 수 있는 문서 스킬만: 원문 문서 → requires_source. AI 초안이 정한 값도 게시에 싣는다(게시는 다시 분류하지 않음). */}
        {showsSourceField(form.kind, form.resultMode) && (
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

        {/* 저장범위 → scope_type */}
        <div className={styles.field}>
          <div className={styles["label-row"]}>
            <label className={styles.label} htmlFor={fieldId("scope")}>
              {t("form.scope")}
            </label>
            <HelpTip label={t("form.scope")} content={<ScopeHelp />} />
          </div>
          <div className={styles.menu}>
            <SelectBox id={fieldId("scope")} value={form.scope} options={scopeOptions} onChange={(scope) => update({ scope })} />
            {/* 팀 스킬은 지금 있는 워크스페이스 한 곳에만 게시한다(publish를 호출한 워크스페이스에 귀속). */}
            {form.scope === "team" && <p className={styles.hint}>{t("form.scopeTeamHint")}</p>}
          </div>
        </div>

        {/* 커맨드명 → name */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("command")}>
            {t("form.command")}
          </label>
          <div className={cx(styles.input, styles["command-input"])}>
            <span className={styles["command-prefix"]} aria-hidden>
              /
            </span>
            <input
              id={fieldId("command")}
              type="text"
              maxLength={SKILL_NAME_MAX}
              placeholder={t("form.commandPlaceholder")}
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
              {t("form.commandHint")}
            </p>
          )}
        </div>

        {/* 설명 → description */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("description")}>
            {t("form.description")}
          </label>
          <input
            id={fieldId("description")}
            type="text"
            className={styles.input}
            placeholder={t("form.descriptionPlaceholder")}
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
            {t("form.rules")}
          </label>
          <textarea
            id={fieldId("rules")}
            className={cx(styles.input, styles.textarea)}
            rows={6}
            placeholder={t("form.rulesPlaceholder")}
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
            idleHint={t("assist.idleHint")}
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
            {t("common.confirm")}
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
            {t("common.confirm")}
          </button>
        </AlertModal>
      )}

      {/* 참고 문서 선택 — 네비게이션 검색과 동일한 중앙 모달 */}
      {referenceDocs.pickerModal}

      {question && (
        <AlertModal
          titleId={fieldId("clarify-title")}
          title={t("review.clarifyTitle")}
          description={question}
          onClose={() => setQuestion(null)}
        >
          <button type="button" className="modal-confirm-button" onClick={() => setQuestion(null)}>
            {t("common.confirm")}
          </button>
        </AlertModal>
      )}
    </SkillSheet>
  );
}
