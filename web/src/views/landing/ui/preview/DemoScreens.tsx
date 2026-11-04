import { PreviewFrame } from "./PreviewFrame";
import { AgentComposer, AgentHeader, ChatThread, Citation, paneStyles, SuggestionBlock } from "./PreviewPanes";
import { GraphPane } from "./PreviewPages";
import { SidebarPanel, type TreeRow } from "./PreviewShell";
import styles from "./Fragments.module.css";

/*
 * 시연 영상 자리의 임시 화면. 영상이 오기 전까지 흐름별 기능을 기존 미리보기 조각으로 보여 준다.
 * 틀 비율은 demo-frame(3:2)이 정한다.
 */

const UPLOAD_ROWS: readonly TreeRow[] = [
  { label: "사용자 조사", depth: 0, kind: "open-folder" },
  { label: "2분기_사용자조사.pdf", depth: 1, kind: "file", badge: "원본 PDF" },
  { label: "2분기 사용자 조사", depth: 1, kind: "file", badge: "변환본", isActive: true },
  { label: "인터뷰 메모", depth: 1, kind: "file", badge: "MD" }
];

export function UploadDemoScreen() {
  return (
    <PreviewFrame className={styles["demo-frame"]}>
      <div className={styles["app"]}>
        <SidebarPanel rows={UPLOAD_ROWS} />
        <article className={styles["doc"]}>
          <h1 className={styles["doc-title"]}>2분기 사용자 조사</h1>
          <p className={styles["doc-meta"]}>PDF에서 변환한 Markdown 문서</p>
          <h2 className={styles["doc-h2"]}>조사 결과 요약</h2>
          <p className={styles["doc-text"]}>응답자 대부분이 자료를 여러 도구에 나눠 보관하고, 필요한 내용을 다시 찾는 데 시간이 든다고 답했다.</p>
          <table className={styles["doc-table"]}>
            <thead>
              <tr>
                <th>항목</th>
                <th>1분기</th>
                <th>2분기</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>자료 검색 시간</td>
                <td>12분</td>
                <td>9분</td>
              </tr>
              <tr>
                <td>사용 도구 수</td>
                <td>4개</td>
                <td>3개</td>
              </tr>
            </tbody>
          </table>
          <h2 className={styles["doc-h2"]}>다음 단계</h2>
          <p className={styles["doc-text"]}>자료를 한곳에 모으는 흐름을 시안으로 만들어 3분기 조사에서 다시 확인한다.</p>
        </article>
      </div>
    </PreviewFrame>
  );
}

export function ConnectAskDemoScreen() {
  return (
    <PreviewFrame className={styles["demo-frame"]}>
      <div className={styles["app"]}>
        <div className={styles["demo-graph"]}>
          <GraphPane />
        </div>
        <section className={paneStyles["agent"]} data-width="hero">
          <AgentHeader title="온보딩 개선" tab="chat" />
          <ChatThread
            data={{
              question: "가입 이탈의 원인을 알려 줘",
              found: ["고객 인터뷰 정리.md"],
              answer: (
                <p>
                  가입 직후 무엇을 해야 할지 모른다는 의견이 가장 많았습니다. <Citation n={1} isActive />
                </p>
              )
            }}
          />
          <div className={styles["demo-composer"]}>
            <AgentComposer placeholder="AI 에이전트에게 무엇이든 물어보세요." />
          </div>
        </section>
      </div>
    </PreviewFrame>
  );
}

export function EditSkillDemoScreen() {
  return (
    <PreviewFrame className={styles["demo-frame"]}>
      <div className={styles["app"]}>
        <article className={styles["doc"]}>
          <h1 className={styles["doc-title"]}>주간 회의 메모</h1>
          <h2 className={styles["doc-h2"]}>결정 사항</h2>
          <SuggestionBlock
            skill="AI 편집"
            removed="온보딩 화면은 디자인과 개발이 모두 진행 중이고 버튼이 잘리는 문제가 남아 있다."
            proposed="온보딩: 디자인 완료, 개발은 버튼 잘림 수정만 남음."
          />
          <h2 className={styles["doc-h2"]}>다음 작업</h2>
          <p className={styles["doc-text"]}>체험판 전환 지표를 정리해 다음 회의에서 공유한다. 버튼 잘림 수정이 끝나면 사용성 테스트를 다시 진행한다.</p>
        </article>
        <section className={paneStyles["agent"]} data-width="hero">
          <AgentHeader title="회의 메모 정리" tab="task" />
          <div className={styles["task-body"]}>
            <p className={paneStyles["agent-caption"]}>확인 필요</p>
            <div className={styles["task-card"]}>
              <p className={styles["task-meta"]}>
                <span>⚡ 문서</span>
                <span>방금 전</span>
              </p>
              <p className={styles["task-title"]}>&quot;결정 사항을 한 줄로 줄여 줘&quot;</p>
            </div>
            <p className={styles["task-chips"]}>
              <span>⚡ 더 짧게</span>
              <span>⚡ 이 요청을 스킬로 저장</span>
            </p>
          </div>
          <div className={styles["demo-composer"]}>
            <AgentComposer placeholder="이 작업에 추가 요청하기 (/스킬 · @문서)" />
          </div>
        </section>
      </div>
    </PreviewFrame>
  );
}
