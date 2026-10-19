import type { CSSProperties } from "react";
import styles from "./LandingMocks.module.css";

/*
 * 랜딩용 제품 화면 구성. 실제 스크린샷 대신 CSS·SVG로 앱 레이아웃(문서 트리 · 본문 · 에이전트 패널, 위키 그래프)을
 * 단순화해 그린다. 장식이라 스크린리더에는 숨기고, 색은 랜딩 토큰과 그래프 토큰(--color-graph-*)만 쓴다.
 */

type Depth = 0 | 1 | 2;

const TREE_ROWS: readonly (readonly [Depth, string])[] = [
  [0, "리서치"],
  [1, "온보딩 인터뷰 정리.md"],
  [1, "제품 기획안.pdf"],
  [1, "경쟁 서비스 메모.md"],
  [0, "회의록"],
  [1, "5월 2주차 주간 회의"],
  [1, "디자인 리뷰"],
  [0, "위키"],
  [1, "사용자 온보딩"],
  [2, "첫 화면 안내"],
  [1, "인터뷰 방법"]
];

const DOC_LINES = [96, 88, 92, 54] as const;
const DOC_LINES_AFTER = [90, 84, 66] as const;

function Line({ width }: { width: number }) {
  return <span className={styles["line"]} style={{ "--w": `${width}%` } as CSSProperties} />;
}

export function EditorMock() {
  return (
    <div className={styles["window"]} aria-hidden="true">
      <div className={styles["sidebar"]}>
        <p className={styles["workspace-name"]}>
          <span className={styles["workspace-badge"]}>R</span>
          리서치 워크스페이스
        </p>
        <ul className={styles["tree"]}>
          {TREE_ROWS.map(([depth, label]) => (
            <li key={label} className={styles["tree-row"]} data-depth={depth} data-active={label === "온보딩 인터뷰 정리.md" || undefined}>
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles["document"]}>
        <p className={styles["breadcrumb"]}>리서치 / 온보딩 인터뷰 정리</p>
        <div className={styles["document-body"]}>
          <p className={styles["document-title"]}>온보딩 인터뷰 정리</p>
          <p className={styles["document-meta"]}>Markdown · 위키 편입 완료</p>
          <p className={styles["document-heading"]}>핵심 내용</p>
          {DOC_LINES.map((width, index) => (
            <Line key={`a${index}`} width={width} />
          ))}
          <p className={styles["document-heading"]}>결정 사항</p>
          {DOC_LINES_AFTER.map((width, index) => (
            <Line key={`b${index}`} width={width} />
          ))}
        </div>
      </div>
      <div className={styles["agent"]}>
        <p className={styles["agent-bubble"]}>인터뷰에서 반복된 불편을 정리해 줘</p>
        <ul className={styles["agent-steps"]}>
          <li>위키 검색</li>
          <li>근거 정리</li>
        </ul>
        <div className={styles["agent-source"]}>
          <span>인터뷰 정리.md</span>
          <span className={styles["agent-tag"]}>source</span>
        </div>
        <div className={styles["agent-source"]}>
          <span>제품 기획안.pdf</span>
          <span className={styles["agent-tag"]}>source</span>
        </div>
        <Line width={94} />
        <Line width={86} />
        <Line width={70} />
        <span className={styles["agent-input"]} />
      </div>
    </div>
  );
}

type GraphNodeKind = "concept" | "source" | "raw";

interface GraphNode {
  readonly x: number;
  readonly y: number;
  readonly kind: GraphNodeKind;
  readonly label?: string;
}

const GRAPH_NODES: readonly GraphNode[] = [
  { x: 300, y: 150, kind: "concept", label: "사용자 온보딩" },
  { x: 170, y: 82, kind: "source", label: "인터뷰 정리" },
  { x: 430, y: 70, kind: "source", label: "제품 기획안" },
  { x: 470, y: 190, kind: "concept", label: "첫 화면 안내" },
  { x: 150, y: 220, kind: "concept", label: "인터뷰 방법" },
  { x: 330, y: 260, kind: "source", label: "주간 회의록" },
  { x: 80, y: 140, kind: "raw" },
  { x: 250, y: 40, kind: "raw" },
  { x: 540, y: 110, kind: "raw" },
  { x: 560, y: 260, kind: "raw" },
  { x: 220, y: 290, kind: "raw" },
  { x: 410, y: 300, kind: "raw" }
];

const GRAPH_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [3, 2], [4, 1]
];

const NODE_RADIUS: Record<GraphNodeKind, number> = { concept: 7, source: 5, raw: 3 };

export function GraphMock() {
  return (
    <div className={styles["window"]} data-variant="graph" aria-hidden="true">
      <div className={styles["sidebar"]}>
        <p className={styles["workspace-name"]}>
          <span className={styles["workspace-badge"]}>R</span>
          리서치 워크스페이스
        </p>
        <ul className={styles["tree"]}>
          {TREE_ROWS.slice(6).map(([depth, label]) => (
            <li key={label} className={styles["tree-row"]} data-depth={depth} data-active={label === "사용자 온보딩" || undefined}>
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles["graph"]}>
        <ul className={styles["graph-legend"]}>
          <li data-kind="concept">concept</li>
          <li data-kind="source">source</li>
          <li data-kind="raw">raw</li>
        </ul>
        <svg className={styles["graph-svg"]} viewBox="0 0 620 330" width="620" height="330" role="presentation">
          <g className={styles["graph-edges"]}>
            {GRAPH_EDGES.map(([from, to]) => (
              <line
                key={`${from}-${to}`}
                x1={GRAPH_NODES[from].x}
                y1={GRAPH_NODES[from].y}
                x2={GRAPH_NODES[to].x}
                y2={GRAPH_NODES[to].y}
              />
            ))}
          </g>
          {GRAPH_NODES.map((node, index) => (
            <g key={`${node.x}-${node.y}`} className={styles["graph-node"]} data-kind={node.kind} data-focus={index === 0 || undefined}>
              {index === 0 ? <circle cx={node.x} cy={node.y} r={18} className={styles["graph-halo"]} /> : null}
              <circle cx={node.x} cy={node.y} r={NODE_RADIUS[node.kind]} />
              {node.label ? (
                <text x={node.x} y={node.y + NODE_RADIUS[node.kind] + 16} textAnchor="middle">
                  {node.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

const TEAM_MEMBERS = [
  { initial: "지", name: "지수", role: "워크스페이스 소유자", badge: "OWNER" },
  { initial: "민", name: "민수", role: "팀 멤버", badge: "MEMBER" }
] as const;

export function TeamMock() {
  return (
    <div className={styles["team"]} aria-hidden="true">
      <div className={styles["team-card"]}>
        <p className={styles["team-kicker"]}>공유 워크스페이스</p>
        <ul className={styles["team-members"]}>
          {TEAM_MEMBERS.map((member) => (
            <li key={member.name}>
              <span className={styles["team-avatar"]}>{member.initial}</span>
              <span className={styles["team-name"]}>
                <strong>{member.name}</strong>
                <span>{member.role}</span>
              </span>
              <span className={styles["team-badge"]}>{member.badge}</span>
            </li>
          ))}
        </ul>
        <p className={styles["team-footer"]}>
          <span>제품팀 / 전략 문서</span>
          <strong>멤버 2명</strong>
        </p>
      </div>
      <div className={styles["team-card"]}>
        <p className={styles["team-kicker"]}>안전한 공동 편집</p>
        <p className={styles["team-flow"]}>
          <span>공동 편집</span>
          <span aria-hidden="true">→</span>
          <span>충돌 확인</span>
          <span aria-hidden="true">→</span>
          <span data-tone="accent">합치기</span>
        </p>
        <p className={styles["team-flow"]}>
          <span>팀 스킬</span>
          <span aria-hidden="true">→</span>
          <span>공유·실행</span>
        </p>
      </div>
    </div>
  );
}
