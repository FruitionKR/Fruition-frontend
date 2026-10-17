"use client";

import { useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDocuments,
  fetchSkillReferenceDocuments,
  uploadSkillReferenceDocument,
  type DocumentItemResponse
} from "@/entities/document";
import { authorSkill, fetchSkills, publishSkill } from "@/entities/skill";
import { ReferenceDocumentPickerModal } from "./ReferenceDocumentPickerModal";
import { documentDisplayName } from "../lib/referenceDocumentPicker";
import { SideSheet } from "@/shared/ui/modal/SideSheet";
import { AlertModal } from "@/shared/ui/modal/AlertModal";
import { Tooltip } from "@/shared/ui/Tooltip";
import { chevronDownSmallIcon, menuSearchIcon, questionMarkIcon, SvgIcon } from "@/shared/ui/SvgIcon";
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
import styles from "./SkillCreateSheet.module.css";

const REFERENCE_DOC_MAX = 3;

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
function issueText(issue: unknown): string {
  if (issue != null && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const category = typeof record.category === "string" ? record.category : "";
    const title = ISSUE_CATEGORY_LABELS[category] ?? String(record.reason ?? (category || "안전 검토 지적"));
    return record.text ? `${title} — "${String(record.text)}"` : title;
  }
  return String(issue);
}

/** Figma check(20×20) 체크 표시. 테두리 상자는 CSS가 그린다. */
function CheckMark() {
  return (
    <svg aria-hidden className={styles["check-mark"]} width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5.45312 9.20794L9.19644 12.727L14.9986 7.27246" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 라벨 옆 물음표 설명 */
function HelpTip({ label, content }: { label: string; content: ReactNode }) {
  return (
    <Tooltip content={content} placement="top" describe={false}>
      <button type="button" className={styles["help-button"]} aria-label={`${label} 설명`}>
        <SvgIcon src={questionMarkIcon} className={styles["help-icon"]} />
      </button>
    </Tooltip>
  );
}

/** Figma btn(선택 상자): 네이티브 select에 Figma 화살표를 겹친다. */
function SelectBox<T extends string>({
  id,
  value,
  options,
  disabled,
  onChange
}: {
  id: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles["select-wrap"]}>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
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

  // 참고 문서 (최대 3개). AI 작성 요청에만 쓰인다(게시 API는 참고 문서를 받지 않는다).
  const [selectedDocs, setSelectedDocs] = useState<DocumentItemResponse[]>([]);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: documents } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: fetchDocuments,
    enabled: docPickerOpen
  });
  // 스킬 참고 문서는 기본 목록에 나오지 않아 따로 조회한다. 메인 트리 캐시와 키를 나눠 업로드가 트리에 섞이지 않게 한다.
  const referenceDocumentsKey = ["skill-reference-documents", workspaceId];
  const { data: referenceDocuments } = useQuery({
    queryKey: referenceDocumentsKey,
    queryFn: fetchSkillReferenceDocuments,
    enabled: docPickerOpen
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

  // AI 작성: enhance(보강, 기본) / preserve(원문 유지 재검토) / regenerate(차단 구간 제거 후 안전 재작성)
  const [authorStatus, setAuthorStatus] = useState("");
  const authorMutation = useMutation({
    mutationFn: (mode: SkillAuthoringMode) =>
      authorSkill(workspaceId, skillAuthorRequest(form, mode, selectedDocs.map((doc) => doc.id))),
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
              <HelpTip
                label="결과 방식"
                content={
                  <>
                    새 문서로 만들기 - 결과를 새 문서로 저장합니다.
                    <br />
                    현재 문서 수정 - 실행한 문서를 바로 고칩니다.
                    <br />
                    상황에 맞게 - 요청에 따라 Agent가 고릅니다.
                  </>
                }
              />
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
              <HelpTip
                label="저장범위"
                content={
                  <>
                    개인 - 모든 워크스페이스에서 사용됩니다.
                    <br />
                    팀 - 현재 워크스페이스에서 사용됩니다.
                  </>
                }
              />
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
            <div className={styles.assist}>
              <div className={styles["assist-docs"]}>
                <button
                  type="button"
                  className={styles["chip-neutral"]}
                  aria-label={`참고 문서 선택 (${selectedDocs.length}/${REFERENCE_DOC_MAX})`}
                  onClick={() => setDocPickerOpen(true)}
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
                      onClick={() => setSelectedDocs((current) => current.filter((item) => item.id !== doc.id))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={() => runAuthor("enhance")}>
                <span aria-hidden>✦</span>
                {authorMutation.isPending ? "AI가 작성하는 중…" : "AI로 작성·보강"}
              </button>
            </div>
            <p className={styles.hint} role="status" aria-live="polite">
              {authorStatus || "적은 실행 규칙과 참고 문서로 AI가 규칙을 다듬어 채워요."}
            </p>
          </div>

          {issues.length > 0 && (
            <div className={styles.issues} role="alert">
              <p className={styles["issues-title"]}>안전 검토에서 저장하지 못했습니다. 실행 규칙을 고쳐 주세요.</p>
              <ul className={styles["issue-list"]}>
                {issues.map((issue, index) => (
                  <li key={index}>{issueText(issue)}</li>
                ))}
              </ul>
              <div className={styles["issue-actions"]}>
                <button type="button" className={styles["chip-primary"]} disabled={isBusy} onClick={() => runAuthor("regenerate")}>
                  <span aria-hidden>✦</span>
                  AI로 안전하게 다시 만들기
                </button>
                <button type="button" className={styles["chip-neutral"]} disabled={isBusy} onClick={() => runAuthor("preserve")}>
                  고친 내용 다시 검토
                </button>
              </div>
            </div>
          )}
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
      {docPickerOpen && (
        <ReferenceDocumentPickerModal
          documents={documents ?? []}
          referenceDocuments={referenceDocuments ?? []}
          selectedDocs={selectedDocs}
          maxCount={REFERENCE_DOC_MAX}
          onToggle={(doc) =>
            setSelectedDocs((current) =>
              current.some((item) => item.id === doc.id)
                ? current.filter((item) => item.id !== doc.id)
                : [...current, doc]
            )
          }
          onUpload={uploadReferenceDocument}
          onClose={() => setDocPickerOpen(false)}
        />
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
    </SideSheet>
  );
}
