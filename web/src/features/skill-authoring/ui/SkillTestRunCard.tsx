"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchDocuments } from "@/entities/document";
import { testRunSkill } from "@/entities/skill";
import { cx } from "@/shared/lib/classNames";
import { SvgIcon } from "@/shared/ui/SvgIcon";
import lightningSmallIcon from "@/shared/assets/svg/common/lightning-small.svg";
import { documentDisplayName, pickerDocuments } from "../lib/referenceDocumentPicker";
import { skillCapabilities, type SkillCreateForm } from "../lib/skillCreateForm";
import {
  defaultSkillTestRunScope,
  describeSkillTestRunError,
  newSkillTestRunId,
  SKILL_TEST_RUN_SCOPE_OPTIONS,
  skillTestRunBlocker,
  skillTestRunRequest,
  skillTestRunView,
  type SkillTestRunInput,
  type SkillTestRunScope
} from "../lib/skillTestRun";
import { issueText, SelectBox } from "./SkillFormParts";
import styles from "./SkillTestRunCard.module.css";

const NO_DOCUMENT = "";

/**
 * 스킬 만들기의 "테스트 실행" 카드 (Figma 1671:14585, 시트 오른쪽 채팅 열).
 * 지금 시트에 적은 정의를 고른 문서 하나에 적용해 섹션별 변경 전/후를 보여 준다. 문서·스킬은 저장하지 않는다.
 */
export function SkillTestRunCard({ workspaceId, form }: { workspaceId: string; form: SkillCreateForm }) {
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const [documentId, setDocumentId] = useState(NO_DOCUMENT);
  // 직접 고르기 전에는 시트의 대상을 따른다('선택한 부분'만이면 줄 범위).
  const [chosenScope, setChosenScope] = useState<SkillTestRunScope | null>(null);
  const scope = chosenScope ?? defaultSkillTestRunScope(form.targets);
  const [startLine, setStartLine] = useState("1");
  const [endLine, setEndLine] = useState("1");

  const { data: documents, isLoading: isDocumentsLoading } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: fetchDocuments
  });
  // 테스트 실행은 Markdown 문서만 받는다(그 밖의 원본은 400). 참고 문서 피커와 같은 기준으로 고른다.
  const candidates = pickerDocuments(documents ?? [], "");
  const documentOptions = [
    { value: NO_DOCUMENT, label: isDocumentsLoading ? "문서를 불러오는 중…" : "테스트할 문서 선택" },
    ...candidates.map((doc) => ({ value: doc.id, label: documentDisplayName(doc) }))
  ];

  const input: SkillTestRunInput = { documentId, scope, startLine: Number(startLine), endLine: Number(endLine) };
  const blocker = skillTestRunBlocker(form, input);

  const runMutation = useMutation({
    // run_id는 한 번만 쓸 수 있어 실행할 때마다 새로 만든다.
    mutationFn: async () => {
      const capabilities = skillCapabilities(form.kind, form.resultMode);
      const result = await testRunSkill(workspaceId, skillTestRunRequest(form, input), newSkillTestRunId());
      return skillTestRunView(result, capabilities);
    }
  });
  const view = runMutation.data;
  const hasRun = view != null || runMutation.isError;

  return (
    <section className={styles.container} aria-labelledby={fieldId("title")}>
      <p className={styles.caption}>새 스킬 만들기</p>
      <div className={styles.card}>
        <div className={styles.heading}>
          <p id={fieldId("title")} className={styles.title}>
            테스트 실행
          </p>
          <p className={styles.sub}>저장 전에 문서 하나로 결과를 확인합니다. 문서는 바뀌지 않아요.</p>
        </div>

        <div className={styles.box}>
          <div className={styles.picker}>
            <label className={styles["sr-only"]} htmlFor={fieldId("document")}>
              테스트할 문서
            </label>
            <SelectBox id={fieldId("document")} value={documentId} options={documentOptions} compact onChange={setDocumentId} />
            <label className={styles["sr-only"]} htmlFor={fieldId("scope")}>
              적용 범위
            </label>
            <SelectBox id={fieldId("scope")} value={scope} options={SKILL_TEST_RUN_SCOPE_OPTIONS} compact onChange={setChosenScope} />
            {scope === "lines" && (
              <div className={styles.lines}>
                <label className={styles["line-field"]}>
                  <span>시작 줄</span>
                  <input type="number" min={1} inputMode="numeric" value={startLine} onChange={(event) => setStartLine(event.target.value)} />
                </label>
                <span aria-hidden className={styles["line-dash"]}>
                  –
                </span>
                <label className={styles["line-field"]}>
                  <span>끝 줄</span>
                  <input type="number" min={1} inputMode="numeric" value={endLine} onChange={(event) => setEndLine(event.target.value)} />
                </label>
              </div>
            )}
            {!isDocumentsLoading && candidates.length === 0 && (
              <p className={styles.note}>테스트할 Markdown 문서가 없어요. 문서를 먼저 만들어 주세요.</p>
            )}
          </div>

          <div className={styles.result} role="status" aria-live="polite" aria-busy={runMutation.isPending}>
            {runMutation.isPending && <p className={styles.note}>AI가 테스트하는 중… 최대 1분쯤 걸려요.</p>}
            {!runMutation.isPending && runMutation.isError && (
              <p className={styles.error} role="alert">
                {describeSkillTestRunError(runMutation.error)}
              </p>
            )}
            {!runMutation.isPending && view != null && <SkillTestRunResult view={view} />}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles["run-button"]}
          disabled={blocker != null || runMutation.isPending}
          aria-describedby={blocker != null ? fieldId("blocker") : undefined}
          onClick={() => runMutation.mutate()}
        >
          <SvgIcon src={lightningSmallIcon} className={styles["run-icon"]} />
          {runMutation.isPending ? "테스트 중…" : hasRun ? "다시 테스트" : "테스트 실행"}
        </button>
        {blocker != null && (
          <p id={fieldId("blocker")} className={styles.note}>
            {blocker}
          </p>
        )}
      </div>
    </section>
  );
}

function SkillTestRunResult({ view }: { view: NonNullable<ReturnType<typeof skillTestRunView>> }) {
  if (view.kind === "blocked") {
    return (
      <div className={styles.blocked} role="alert">
        <p className={styles["blocked-title"]}>안전 검토에서 막혀 실행하지 않았어요. 실행 규칙을 고쳐 주세요.</p>
        <ul className={styles["issue-list"]}>
          {(view.issues.length > 0 ? view.issues : ["안전 검토에서 위험한 표현이 발견되었습니다."]).map((issue, index) => (
            <li key={index}>{issueText(issue)}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (view.kind === "created") {
    return (
      <div className={styles.list}>
        <p className={styles.section}>만들어질 문서</p>
        <pre className={cx(styles.diff, styles.created)}>{view.markdown}</pre>
      </div>
    );
  }
  if (view.kind === "unchanged") {
    return <p className={styles.note}>바뀐 내용이 없어요.</p>;
  }
  return (
    <div className={styles.list}>
      {view.changes.map((change, index) => (
        <div key={`${change.start_line}-${index}`} className={styles.change}>
          <p className={styles.section}>
            {change.section} · {change.start_line}–{change.end_line}줄
          </p>
          <div className={styles.diff}>
            <p className={styles.before}>{change.before}</p>
            <p className={styles.after}>→ {change.after}</p>
          </div>
        </div>
      ))}
      {view.untouchedSections.length > 0 && (
        <p className={styles.section}>다른 섹션 변경 없음 ({view.untouchedSections.join(" · ")})</p>
      )}
    </div>
  );
}
