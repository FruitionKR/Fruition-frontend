import type { ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import { bellIcon, settingIcon, sidebarToggleIcon, SvgIcon, userCircleOutlineIcon } from "@/shared/ui/SvgIcon";
import {
  SidebarChevronIcon,
  SidebarPlusIcon,
  SidebarSearchIcon,
  SidebarWorkspaceChevronIcon
} from "@/widgets/document-sidebar/ui/SidebarIcons";
import {
  RailArchiveIcon,
  RailBellIcon,
  RailHomeIcon,
  RailLightningIcon,
  RailLogoIcon,
  RailSettingIcon,
  RailUserIcon,
  RailWorkIcon
} from "@/widgets/rail-navigation/ui/RailIcons";
import railStyles from "@/widgets/rail-navigation/ui/RailNavigation.module.css";
import base from "./Preview.module.css";
import styles from "./PreviewShell.module.css";

/*
 * 앱 셸(좌측 레일 + 문서 사이드바) 미리보기. Figma 1571:27625(main) · 1540:21567(member)의 SNB와
 * 실제 서비스 화면을 따른다. 레일은 실제 RailNavigation의 스타일과 아이콘을 그대로 쓴다.
 */

export type ShellSidebar = "documents" | "graph" | "settings";
type ShellView = "home" | "skills" | "settings";

interface TreeRow {
  readonly label: string;
  readonly depth: 0 | 1 | 2;
  readonly kind: "folder" | "open-folder" | "file";
  readonly badge?: string;
  readonly isActive?: boolean;
}

// Figma 1571:27625 문서 트리 구성(폴더 · 펼친 폴더 · PDF/TXT/MD 파일)
const TREE: readonly TreeRow[] = [
  { label: "교수님 프로젝트 자료", depth: 0, kind: "folder" },
  { label: "아동복지 기금 관련 논문", depth: 0, kind: "folder" },
  { label: "연간 활동 계획서", depth: 0, kind: "open-folder" },
  { label: "2학기 활동계획서", depth: 1, kind: "folder" },
  { label: "프로젝트 타임라인", depth: 1, kind: "open-folder" },
  { label: "학기별 목표 설정", depth: 2, kind: "file", badge: "PDF" },
  { label: "정서 발달과 또래 관계", depth: 2, kind: "file", badge: "MD", isActive: true },
  { label: "10/13 회의록", depth: 2, kind: "file", badge: "MD" },
  { label: "장애 아동 통합 교육의 효과", depth: 0, kind: "folder" },
  { label: "유아 교육 방법론", depth: 0, kind: "folder" },
  { label: "창의력 발달 프로그램", depth: 0, kind: "folder" },
  { label: "언어 습득 촉진 전략", depth: 0, kind: "folder" },
  { label: "놀이 기반 학습 기법", depth: 0, kind: "folder" }
];

function Rail({ view }: { view: ShellView }) {
  const items = [
    { id: "home", Icon: RailHomeIcon },
    { id: "skills", Icon: RailLightningIcon },
    { id: "logs", Icon: RailArchiveIcon },
    { id: "notifications", Icon: RailBellIcon }
  ] as const;
  return (
    <div className={railStyles["rail"]}>
      <div className={railStyles["rail-section"]}>
        <span className={railStyles["rail-logo"]}>
          <RailLogoIcon />
        </span>
        <span className={railStyles["rail-divider"]} />
        <div className={railStyles["rail-group"]}>
          {items.map(({ id, Icon }) => (
            <span key={id} className={cx(railStyles["rail-button"], view === id && railStyles["is-active"])}>
              <Icon />
            </span>
          ))}
        </div>
        <span className={railStyles["rail-divider"]} />
        <span className={railStyles["rail-button"]}>
          <RailWorkIcon />
        </span>
      </div>
      <div className={cx(railStyles["rail-section"], railStyles["is-bottom"])}>
        <span className={railStyles["rail-divider"]} />
        <span className={cx(railStyles["rail-button"], view === "settings" && railStyles["is-active"])}>
          <RailSettingIcon />
        </span>
        <span className={railStyles["rail-button"]}>
          <RailUserIcon />
        </span>
      </div>
    </div>
  );
}

function TreeIcon({ kind }: { kind: TreeRow["kind"] }) {
  if (kind === "file") return <span className={styles["tree-slot"]} />;
  return (
    <span className={styles["tree-slot"]}>
      <SidebarChevronIcon className={cx(styles["tree-arrow"], kind === "open-folder" && styles["is-open"])} />
    </span>
  );
}

function DocumentTree({ sidebar }: { sidebar: "documents" | "graph" }) {
  return (
    <>
      <div className={styles["segment"]}>
        <span className={cx(sidebar === "documents" && styles["is-active"])}>문서</span>
        <span className={cx(sidebar === "graph" && styles["is-active"])}>그래프</span>
      </div>
      <p className={styles["sidebar-index"]}>FILE</p>
      <ul className={styles["tree"]}>
        {TREE.map((row) => (
          <li
            key={row.label}
            className={cx(styles["tree-row"], row.isActive && styles["is-active"])}
            data-depth={row.depth}
          >
            <TreeIcon kind={row.kind} />
            <span className={styles["tree-label"]}>{row.label}</span>
            {row.badge ? <span className={styles["tree-badge"]}>{row.badge}</span> : null}
          </li>
        ))}
      </ul>
      <p className={styles["tree-add"]}>
        <SidebarPlusIcon size={20} />새 노트 추가
      </p>
    </>
  );
}

function SettingsMenu() {
  return (
    <div className={styles["settings-menu"]}>
      <p className={styles["settings-group"]}>계정</p>
      <p className={styles["settings-row"]}>
        <span className={styles["workspace-badge"]} data-size="small">지</span>사용자 설정
      </p>
      <p className={styles["settings-row"]}>
        <SvgIcon src={bellIcon} className={styles["settings-icon"]} />알림 설정
      </p>
      <p className={styles["settings-group"]}>설정</p>
      <p className={styles["settings-row"]}>
        <SvgIcon src={settingIcon} className={styles["settings-icon"]} />워크스페이스 설정
      </p>
      <p className={cx(styles["settings-row"], styles["is-active"])}>
        <SvgIcon src={userCircleOutlineIcon} className={styles["settings-icon"]} />멤버 관리
      </p>
    </div>
  );
}

export function PreviewShell({
  sidebar,
  view = sidebar === "settings" ? "settings" : "home",
  children
}: {
  sidebar: ShellSidebar;
  /** 레일에서 선택된 메뉴. 기본은 사이드바에 맞춘다(스킬 화면은 문서 트리 + 스킬 메뉴). */
  view?: ShellView;
  children: ReactNode;
}) {
  return (
    <div className={styles["app"]}>
      <aside className={styles["sidebar"]}>
        <div className={styles["sidebar-top"]}>
          <span className={styles["workspace"]}>
            <span className={styles["workspace-badge"]}>연</span>
            <span className={styles["workspace-name"]}>연구실 워크스페이스</span>
            <SidebarWorkspaceChevronIcon />
          </span>
          <SvgIcon src={sidebarToggleIcon} className={base["sidebar-toggle"]} />
        </div>
        <div className={styles["sidebar-body"]}>
          <Rail view={view} />
          <div className={styles["sidebar-panel"]}>
            <p className={styles["search"]}>
              <SidebarSearchIcon />
              통합 검색
            </p>
            {sidebar === "settings" ? <SettingsMenu /> : <DocumentTree sidebar={sidebar} />}
          </div>
        </div>
      </aside>
      <div className={styles["main"]}>{children}</div>
    </div>
  );
}
