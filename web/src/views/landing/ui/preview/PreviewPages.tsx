import { useId } from "react";
import { SkillMoreIcon, SkillSearchIcon, SkillSortIcon } from "@/widgets/skills-view/ui/SkillIcons";
import { PreviewGraphChips } from "./PreviewGraphChips";
import base from "./Preview.module.css";
import styles from "./PreviewPages.module.css";

/*
 * 위키 그래프 · 스킬 · 멤버 관리 화면 미리보기. Figma 1406:13761(graph), 1482:9848(skill), 1540:21567(member)을 따르고,
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

// Figma 1406:13761 노드 배치를 그래프 영역(1000×700) 좌표로 옮겼다.
const NODES: readonly GraphNode[] = [
  { id: "hub", x: 520, y: 330, kind: "source", label: "통합 교육 효과 분석" },
  { id: "peer", x: 330, y: 205, kind: "source", label: "또래 관계 종단 연구" },
  { id: "report", x: 690, y: 190, kind: "source", label: "정서 발달 보고서" },
  { id: "family", x: 340, y: 470, kind: "source", label: "가족 지원 프로그램" },
  { id: "teacher", x: 700, y: 430, kind: "source", label: "교사 인식 설문" },
  { id: "c1", x: 230, y: 215, kind: "concept", label: "또래 수용" },
  { id: "c2", x: 400, y: 250, kind: "concept", label: "사회적 기술" },
  { id: "c3", x: 300, y: 280, kind: "concept", label: "또래 매개 중재" },
  { id: "c4", x: 430, y: 175, kind: "concept", label: "교육과정 수정" },
  { id: "c5", x: 560, y: 245, kind: "concept", label: "개별화 교육계획" },
  { id: "c6", x: 640, y: 150, kind: "concept", label: "자아 개념" },
  { id: "c7", x: 770, y: 225, kind: "concept", label: "정서 조절" },
  { id: "c8", x: 610, y: 315, kind: "concept", label: "정서 지원" },
  { id: "c9", x: 800, y: 300, kind: "concept", label: "통합 환경" },
  { id: "c10", x: 420, y: 395, kind: "concept", label: "사회성 발달" },
  { id: "c11", x: 470, y: 450, kind: "concept", label: "소속감" },
  { id: "c12", x: 560, y: 400, kind: "concept", label: "자기 효능감" },
  { id: "c13", x: 260, y: 420, kind: "concept", label: "부모 참여" },
  { id: "c14", x: 400, y: 525, kind: "concept", label: "양육 태도" },
  { id: "c15", x: 780, y: 385, kind: "concept", label: "교사 효능감" },
  { id: "c16", x: 620, y: 480, kind: "concept", label: "교사 연수" },
  { id: "r1", x: 310, y: 120, kind: "raw", label: "또래관계_연구.pdf" },
  { id: "r2", x: 735, y: 120, kind: "raw", label: "정서발달_보고서.pdf" },
  { id: "r3", x: 500, y: 200, kind: "raw", label: "통합교육_효과분석.docx" },
  { id: "r4", x: 235, y: 540, kind: "raw", label: "가족지원_프로그램.pdf" },
  { id: "r5", x: 820, y: 470, kind: "raw", label: "교사인식_설문.docx" }
];

const EDGES: readonly (readonly [string, string])[] = [
  ["hub", "peer"], ["hub", "report"], ["hub", "family"], ["hub", "teacher"],
  ["hub", "c5"], ["hub", "c8"], ["hub", "c10"], ["hub", "c11"], ["hub", "c12"], ["hub", "c9"], ["hub", "c4"],
  ["peer", "c1"], ["peer", "c2"], ["peer", "c3"], ["peer", "c10"],
  ["report", "c6"], ["report", "c7"], ["report", "c9"],
  ["family", "c13"], ["family", "c14"], ["family", "c10"], ["family", "c11"],
  ["teacher", "c15"], ["teacher", "c16"], ["teacher", "c12"]
];

const RAW_EDGES: readonly (readonly [string, string])[] = [
  ["r1", "peer"], ["r2", "report"], ["r3", "hub"], ["r4", "family"], ["r5", "teacher"]
];

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
  // 히어로와 지식화 장에 그래프가 두 번 그려지므로 그라데이션 id를 겹치지 않게 만든다.
  const glowId = useId();
  return (
    <div className={styles["graph"]}>
      <PreviewGraphChips raw={5} source={5} concept={16} />
      <svg className={styles["graph-svg"]} viewBox="0 0 1000 640" width="1000" height="640">
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
          <circle cx={600} cy={560} r={16} className={styles["graph-progress-track"]} />
          <circle cx={600} cy={560} r={16} className={styles["graph-progress-ring"]} pathLength={100} />
          <text x={600} y={564} textAnchor="middle">58%</text>
          <text x={600} y={598} textAnchor="middle" className={styles["graph-progress-label"]}>
            학습지원 사례집
          </text>
        </g>
      </svg>
    </div>
  );
}

const SKILLS = [
  { command: "/meeting-summary", description: "회의 내용을 정해진 형식으로 정리합니다.", scope: "개인" },
  { command: "/research-summary", description: "연구 자료의 핵심을 근거와 함께 요약합니다.", scope: "팀" },
  { command: "/weekly-summary", description: "주간 업무 진행 상황을 요약합니다.", scope: "팀" },
  { command: "/file-organize", description: "문서를 주제별 폴더로 정리합니다.", scope: "개인" },
  { command: "/client-feedback", description: "고객 의견을 모아 개선점을 도출합니다.", scope: "팀" }
] as const;

export function SkillsPane() {
  return (
    <div className={styles["page"]}>
      <header className={styles["page-title"]}>
        <h1>스킬</h1>
        <p>반복 작업을 안전한 실행 규칙으로 만들어 Fruition Agent에서 재사용합니다.</p>
      </header>
      <div className={styles["page-tabs"]}>
        <span className={styles["page-tab"]} data-active>
          전체 스킬
        </span>
        <span className={styles["page-tab"]}>팀 스킬</span>
        <span className={styles["page-tab"]}>개인 스킬</span>
        <span className={styles["page-tools"]}>
          <SkillSearchIcon />
          <span className={base["button-primary"]} data-size="medium">
            스킬 만들기
          </span>
        </span>
      </div>
      <table className={styles["table"]}>
        <thead>
          <tr>
            <th>
              커맨드 <SkillSortIcon />
            </th>
            <th>설명</th>
            <th>저장범위</th>
            <th>사용 상태</th>
            <th aria-label="더보기" />
          </tr>
        </thead>
        <tbody>
          {SKILLS.map((skill) => (
            <tr key={skill.command}>
              <td>{skill.command}</td>
              <td>{skill.description}</td>
              <td>
                <span className={styles["scope-chip"]}>{skill.scope}</span>
              </td>
              <td>
                <span className={styles["run-link"]}>실행</span>
              </td>
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

const MEMBERS = [
  { name: "김지수", email: "jisoo@example.com", role: "OWNER" },
  { name: "박민수", email: "minsoo@example.com", role: "OWNER" },
  { name: "이서연", email: "seoyeon@example.com", role: "MEMBER" },
  { name: "최도윤", email: "doyoon@example.com", role: "MEMBER" },
  { name: "정하린", email: "harin@example.com", role: "MEMBER" }
] as const;

export function MembersPane() {
  return (
    <div className={styles["page"]} data-width="narrow">
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
