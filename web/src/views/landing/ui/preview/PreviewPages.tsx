import { useId } from "react";
import { SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "@/widgets/skills-view/ui/SkillIcons";
import { PreviewGraphChips } from "./PreviewGraphChips";
import base from "./Preview.module.css";
import styles from "./PreviewPages.module.css";

/*
 * 위키 그래프 · 멤버 관리 화면 조각. Figma 1406:13761(graph), 1540:21567(member)을 따르고,
 * 그래프 범례는 실제 GraphFilterChips를, 색은 그래프 캔버스 팔레트(graphColors.ts)와 같은 값을 쓴다.
 */

type NodeKind = "concept" | "source" | "raw";

interface GraphNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: NodeKind;
  readonly label: string;
}

type Link = readonly [string, string];

// 제품 기획 워크스페이스 예시. 그래프 영역 760×480 좌표.
const NODES: readonly GraphNode[] = [
  { id: "hub", x: 380, y: 230, kind: "source", label: "온보딩 개선 기획서" },
  { id: "s1", x: 190, y: 120, kind: "source", label: "고객 인터뷰 정리" },
  { id: "s2", x: 590, y: 110, kind: "source", label: "경쟁사 분석" },
  { id: "s3", x: 200, y: 360, kind: "source", label: "3분기 회의록" },
  { id: "s4", x: 590, y: 350, kind: "source", label: "사용성 테스트 결과" },
  { id: "c1", x: 90, y: 180, kind: "concept", label: "가입 이탈" },
  { id: "c2", x: 300, y: 80, kind: "concept", label: "첫 사용 경험" },
  { id: "c3", x: 470, y: 160, kind: "concept", label: "가격 정책" },
  { id: "c4", x: 690, y: 200, kind: "concept", label: "체험판 전환" },
  { id: "c5", x: 270, y: 260, kind: "concept", label: "튜토리얼" },
  { id: "c6", x: 500, y: 290, kind: "concept", label: "알림 설정" },
  { id: "c7", x: 110, y: 300, kind: "concept", label: "고객 세그먼트" },
  { id: "c8", x: 330, y: 420, kind: "concept", label: "출시 일정" },
  { id: "c9", x: 690, y: 420, kind: "concept", label: "버튼 잘림 문제" },
  { id: "r1", x: 140, y: 40, kind: "raw", label: "인터뷰_원본.pdf" },
  { id: "r2", x: 680, y: 40, kind: "raw", label: "경쟁사_자료.pdf" },
  { id: "r3", x: 90, y: 430, kind: "raw", label: "회의_녹음.m4a" }
];

const EDGES: readonly Link[] = [
  ["hub", "s1"], ["hub", "s2"], ["hub", "s3"], ["hub", "s4"], ["hub", "c3"], ["hub", "c5"], ["hub", "c6"], ["hub", "c2"],
  ["s1", "c1"], ["s1", "c2"], ["s1", "c7"], ["s2", "c3"], ["s2", "c4"], ["s3", "c8"], ["s3", "c7"], ["s4", "c9"], ["s4", "c6"], ["s4", "c4"]
];

const RAW_EDGES: readonly Link[] = [["r1", "s1"], ["r2", "s2"], ["r3", "s3"]];

const RADIUS: Record<NodeKind, number> = { source: 7, concept: 6, raw: 4.5 };
const byId = new Map(NODES.map((node) => [node.id, node]));

function Edge({ from, to, isRaw }: { from: string; to: string; isRaw?: boolean }) {
  const a = byId.get(from);
  const b = byId.get(to);
  if (!a || !b) return null;
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={isRaw ? styles["graph-raw-edge"] : styles["graph-edge"]} />;
}

export function GraphPane() {
  const hub = byId.get("hub");
  const glowId = useId();
  return (
    <div className={styles["graph"]}>
      <PreviewGraphChips raw={3} source={5} concept={9} />
      <svg className={styles["graph-svg"]} viewBox="0 -10 760 490" width="760" height="490">
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" className={styles["graph-glow-start"]} />
            <stop offset="100%" className={styles["graph-glow-end"]} />
          </radialGradient>
        </defs>
        {hub ? <circle cx={hub.x} cy={hub.y} r={70} fill={`url(#${glowId})`} /> : null}
        {EDGES.map(([from, to]) => (
          <Edge key={`${from}-${to}`} from={from} to={to} />
        ))}
        {RAW_EDGES.map(([from, to]) => (
          <Edge key={`${from}-${to}`} from={from} to={to} isRaw />
        ))}
        {NODES.map((node) => (
          <g key={node.id} className={styles["graph-node"]} data-kind={node.id === "hub" ? "hover" : node.kind}>
            <circle cx={node.x} cy={node.y} r={node.id === "hub" ? 9 : RADIUS[node.kind]} />
            <text x={node.x} y={node.y + (node.kind === "raw" ? 16 : 22)} textAnchor="middle">
              {node.label}
            </text>
          </g>
        ))}
        <g className={styles["graph-progress"]}>
          <circle cx={520} cy={420} r={16} className={styles["graph-progress-track"]} />
          <circle cx={520} cy={420} r={16} className={styles["graph-progress-ring"]} pathLength={100} />
          <text x={520} y={424} textAnchor="middle">
            64%
          </text>
          <text x={520} y={458} textAnchor="middle" className={styles["graph-progress-label"]}>
            가격 실험 결과 편입 중
          </text>
        </g>
      </svg>
    </div>
  );
}

const MEMBERS = [
  { name: "김지수", email: "jisoo@example.com", role: "OWNER" },
  { name: "박민수", email: "minsoo@example.com", role: "OWNER" },
  { name: "이서연", email: "seoyeon@example.com", role: "MEMBER" }
] as const;

/** 설정 › 멤버 관리 목록 조각 (Figma 1540:21567) */
export function MembersPane() {
  return (
    <div className={styles["page"]}>
      <header className={styles["page-title"]}>
        <h1>멤버 관리</h1>
        <p>워크스페이스에 있는 사람과 역할을 관리합니다.</p>
      </header>
      <div className={styles["member-toolbar"]}>
        <span>
          총 <strong>{MEMBERS.length}</strong>명
        </span>
        <span className={styles["page-tools"]}>
          <SkillSearchIcon />
          <span className={styles["filter"]}>권한 ⌄</span>
          <span className={base["button-primary"]} data-size="small">
            멤버 초대하기
          </span>
        </span>
      </div>
      <table className={styles["table"]} data-variant="members">
        <thead>
          <tr>
            <th>
              <span className={styles["checkbox"]} />
              사용자 <SkillSortIcon />
            </th>
            <th>사용 권한</th>
            <th aria-label="더보기" />
          </tr>
        </thead>
        <tbody>
          {MEMBERS.map((member) => (
            <tr key={member.email}>
              <td>
                <span className={styles["checkbox"]} />
                <span className={styles["member-avatar"]}>{member.name.slice(1, 2)}</span>
                <span className={styles["member-name"]}>
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                </span>
              </td>
              <td>{member.role} ⌄</td>
              <td>
                <SkillMoreIcon />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
