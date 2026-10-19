import { PreviewFrame } from "./PreviewFrame";
import { AgentComposer, AgentHeader, ChatThread, Citation, paneStyles } from "./PreviewPanes";
import { GraphPane, MembersPane } from "./PreviewPages";
import { SidebarPanel, type TreeRow } from "./PreviewShell";
import base from "./Preview.module.css";
import styles from "./Fragments.module.css";

/*
 * 히어로 · 핵심 기능 · 팀 섹션의 앱 화면 조각. 화면마다 다른 예시 자료를 쓴다.
 * - 히어로: 연구 자료(논문) — 채팅 근거 답변 + 원문 미리보기 (Figma 1540:19718)
 * - 올리기·변환: 시장 조사 자료 — 사이드바 업로드 + 변환된 문서 + 알림 카드 (Figma 1571:27625 SNB)
 * - 위키·그래프: 제품 기획 — 위키 그래프 (Figma 1406:13761)
 * - 근거 있는 답변: 고객 인터뷰 — 답변과 참고 자료 목록 (Figma 1540:19718)
 * - 팀: 멤버 관리 (Figma 1540:21567)
 */

export function HeroPreview() {
  return (
    <PreviewFrame className={styles["hero-frame"]}>
      <div className={styles["hero-app"]}>
        <section className={paneStyles["agent"]} data-width="fill">
          <AgentHeader title="선행 연구 정리" tab="chat" />
          <ChatThread
            data={{
              question: "또래 관계가 정서 조절에 어떤 영향을 주는지, 올려 둔 자료 기준으로 정리해 줘",
              steps: [
                { label: "위키에서 관련 페이지 6건 찾음", state: "done" },
                { label: "출처 문서 2건 확인", state: "done" }
              ],
              answer: (
                <>
                  <p>
                    또래 관계의 질이 높을수록 정서 조절 능력도 함께 발달합니다. <Citation n={1} isActive />
                  </p>
                  <p>
                    특히 갈등을 원만하게 해결한 경험이 이후 사회적 기술을 높였다는 종단 결과가 있습니다. <Citation n={2} />
                  </p>
                  <ul className={styles["source-list"]}>
                    <li data-active>
                      <span>1</span>또래관계_종단연구.pdf · 12쪽
                    </li>
                    <li>
                      <span>2</span>정서발달_보고서.pdf · 4쪽
                    </li>
                  </ul>
                </>
              )
            }}
          />
          <AgentComposer placeholder="AI 에이전트에게 무엇이든 물어보세요." />
        </section>
        <aside className={styles["source-pane"]}>
          <p className={styles["source-head"]}>
            <span className={styles["source-number"]}>1</span>
            또래관계_종단연구.pdf
            <span className={styles["source-page"]}>12쪽</span>
          </p>
          <div className={styles["source-body"]}>
            <p className={styles["source-heading"]}>4. 결과</p>
            <p>
              초등 저학년 아동 312명을 3년간 추적한 결과,{" "}
              <mark>또래 관계의 질이 높은 집단에서 정서 조절 점수가 꾸준히 높게 나타났다.</mark> 이 차이는 가정 환경 변수를 통제한
              뒤에도 유지되었다.
            </p>
            <p>갈등 해결 경험이 많은 아동은 이듬해 사회적 기술 평가에서도 더 높은 점수를 받았다.</p>
            <p className={styles["source-heading"]}>5. 논의</p>
            <p>또래 관계는 정서 조절을 연습하는 일상적인 환경으로 작동한다.</p>
          </div>
        </aside>
      </div>
    </PreviewFrame>
  );
}

const UPLOAD_ROWS: readonly TreeRow[] = [
  { label: "시장 조사", depth: 0, kind: "open-folder" },
  { label: "2026_시장보고서.pdf", depth: 1, kind: "file", status: "변환 중" },
  { label: "2026 시장 보고서", depth: 1, kind: "file", badge: "MD", isActive: true },
  { label: "경쟁사 비교표", depth: 1, kind: "file", badge: "MD" },
  { label: "가격 정책 메모", depth: 1, kind: "file", badge: "TXT" },
  { label: "고객 설문", depth: 0, kind: "folder" },
  { label: "투자 자료", depth: 0, kind: "folder" }
];

export function UploadPreview() {
  return (
    <PreviewFrame width={760} height={520}>
      <div className={styles["split-app"]}>
        <SidebarPanel rows={UPLOAD_ROWS} />
        <article className={styles["doc"]}>
          <p className={styles["doc-crumb"]}>시장 조사 / 2026 시장 보고서</p>
          <h1 className={styles["doc-title"]}>2026 시장 보고서</h1>
          <p className={styles["doc-meta"]}>PDF에서 변환한 Markdown 문서</p>
          <h2 className={styles["doc-h2"]}>1. 시장 규모</h2>
          <p className={styles["doc-text"]}>국내 협업 도구 시장은 전년 대비 18% 성장했으며, AI 기능을 갖춘 도구의 비중이 빠르게 늘고 있다.</p>
          <table className={styles["doc-table"]}>
            <thead>
              <tr>
                <th>구분</th>
                <th>2025</th>
                <th>2026</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>전체 시장</td>
                <td>1.2조</td>
                <td>1.4조</td>
              </tr>
              <tr>
                <td>AI 도구</td>
                <td>0.3조</td>
                <td>0.5조</td>
              </tr>
            </tbody>
          </table>
        </article>
        <div className={styles["notice"]}>
          <p className={styles["notice-title"]}>문서 변환이 끝났어요</p>
          <p className={styles["notice-text"]}>2026_시장보고서.pdf를 Markdown 문서로 바꿨습니다.</p>
          <p className={styles["notice-actions"]}>
            <span className={styles["notice-secondary"]}>닫기</span>
            <span className={base["button-primary"]} data-size="small">
              위키 편입
            </span>
          </p>
        </div>
      </div>
    </PreviewFrame>
  );
}

export function GraphPreview() {
  return (
    <PreviewFrame width={760} height={520}>
      <div className={styles["graph-app"]}>
        <GraphPane />
      </div>
    </PreviewFrame>
  );
}

const INTERVIEW_SOURCES = [
  { n: 1, name: "고객 인터뷰 — 김OO 디자이너", quote: "가입하고 나서 뭘 먼저 해야 할지 몰랐어요.", kind: "source" },
  { n: 2, name: "고객 인터뷰 — 박OO 팀장", quote: "팀원 초대 버튼을 한참 찾았습니다.", kind: "source" },
  { n: 3, name: "첫 사용 경험", quote: "인터뷰 7건 중 5건에서 첫 화면 안내 부족을 언급", kind: "concept" }
] as const;

export function AnswerPreview() {
  return (
    <PreviewFrame width={620} height={470}>
      <section className={paneStyles["agent"]} data-width="fill">
        <AgentHeader title="인터뷰 정리" tab="chat" />
        <ChatThread
          data={{
            question: "고객들이 가장 많이 말한 불편은 뭐야?",
            answer: (
              <>
                <p>
                  가장 많이 나온 불편은 가입 직후 무엇을 해야 할지 모른다는 점입니다. <Citation n={1} />
                  <Citation n={3} />
                </p>
                <p>
                  그다음은 팀원 초대 기능을 찾기 어렵다는 의견이었습니다. <Citation n={2} />
                </p>
                <p className={paneStyles["agent-caption"]}>참고한 자료 {INTERVIEW_SOURCES.length}건</p>
                <ul className={styles["quote-list"]}>
                  {INTERVIEW_SOURCES.map((source) => (
                    <li key={source.n} data-kind={source.kind}>
                      <p className={styles["quote-head"]}>
                        <span className={styles["source-number"]}>{source.n}</span>
                        {source.name}
                        <span className={styles["quote-kind"]}>{source.kind === "concept" ? "개념 페이지" : "출처 페이지"}</span>
                      </p>
                      <p className={styles["quote-text"]}>“{source.quote}”</p>
                    </li>
                  ))}
                </ul>
              </>
            )
          }}
        />
      </section>
    </PreviewFrame>
  );
}

export function TeamPreview() {
  return (
    <PreviewFrame width={760} height={470} className={styles["team-frame"]}>
      <div className={styles["graph-app"]}>
        <MembersPane />
      </div>
    </PreviewFrame>
  );
}
