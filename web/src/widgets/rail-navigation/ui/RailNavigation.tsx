import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { cx } from "@/shared/lib/classNames";
import { Tooltip } from "@/shared/ui/Tooltip";
import { RailArchiveIcon, RailBellIcon, RailGraphIcon, RailHomeIcon, RailLightningIcon, RailLogoIcon } from "./RailIcons";
import styles from "./RailNavigation.module.css";

export type RailView = "home" | "graph" | "skills" | "logs" | "notifications" | "settings";

/** 화면 이름표. 빈 화면 aria-label 등에서 label만 쓴다. */
export const railItems: { id: RailView; label: string }[] = [
  { id: "home", label: "홈" },
  { id: "graph", label: "그래프" },
  { id: "skills", label: "스킬" },
  { id: "logs", label: "로그" },
  { id: "notifications", label: "알림" },
  { id: "settings", label: "설정" }
];

// 레일에 아이콘으로 노출하는 화면 (Figma 1406:10278). 문서(홈)/그래프 전환도 레일 버튼이 맡는다.
const navItems: { id: RailView; label: string; Icon: ComponentType<{ className?: string }>; isActive: (view: RailView) => boolean }[] = [
  { id: "home", label: "홈", Icon: RailHomeIcon, isActive: (view) => view === "home" },
  { id: "graph", label: "그래프", Icon: RailGraphIcon, isActive: (view) => view === "graph" },
  { id: "skills", label: "스킬", Icon: RailLightningIcon, isActive: (view) => view === "skills" },
  { id: "logs", label: "로그", Icon: RailArchiveIcon, isActive: (view) => view === "logs" }
];

/**
 * 레일 36px 정사각 아이콘 버튼 (Figma 전체 알림 / side_tab).
 * 설명은 네이티브 title 대신 오른쪽 Tooltip으로 띄운다. tooltip을 생략하면 label을 그대로 쓴다.
 */
export function RailButton({
  label,
  tooltip,
  tooltipHint,
  isActive = false,
  hasIndicator = false,
  className,
  children,
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  /** 말풍선 본문. 기본값은 label */
  tooltip?: string;
  /** 말풍선 보조줄(단축키·비활성 사유) */
  tooltipHint?: ReactNode;
  isActive?: boolean;
  /** 할 일이 있을 때 오른쪽 위에 켜는 주황 점(알림 탭 안 읽음 점과 같은 모양) */
  hasIndicator?: boolean;
}) {
  const tooltipText = tooltip ?? label;
  return (
    <Tooltip
      content={tooltipText}
      hint={tooltipHint}
      // 팝오버·메뉴가 열려 있으면 말풍선이 그 위를 덮지 않게 숨긴다.
      disabled={buttonProps["aria-expanded"] === true}
      describe={tooltipText !== label || Boolean(tooltipHint)}
    >
      <button
        type="button"
        {...buttonProps}
        className={cx(styles["rail-button"], isActive && styles["is-active"], className)}
        aria-label={label}
      >
        {children}
        {hasIndicator && <span className={styles["rail-indicator"]} aria-hidden />}
      </button>
    </Tooltip>
  );
}

/** 레일 그룹 사이 28px 구분선 (Figma Vector 224) */
export function RailDivider() {
  return <span className={styles["rail-divider"]} aria-hidden />;
}

/** 4px 간격 세로 아이콘 묶음 (Figma test) */
export function RailGroup({ children }: { children: ReactNode }) {
  return <div className={styles["rail-group"]}>{children}</div>;
}

/**
 * 좌측 53px 아이콘 레일 (Figma 1486:4340 / 1527:16289). 사이드바 상단 바(45px) 아래에서 시작한다.
 * 상단: 로고 · 화면 이동(홈/그래프/스킬/로그/알림) · 화면별 도구(tools), 하단: 설정·프로필(footer).
 * isCollapsed: 사이드바를 접어 레일만 남은 상태 (Figma 1540:17920). 문서 패널 경계선이 없어 오른쪽 선을 사이드바 테두리에 맡긴다.
 */
export function RailNavigation({
  isCollapsed = false,
  activeView,
  onViewChange,
  tools,
  footer
}: {
  isCollapsed?: boolean;
  activeView: RailView;
  onViewChange: (view: RailView) => void;
  /** 진행 중 작업, 그래프 위키 액션처럼 화면마다 달라지는 도구 묶음 */
  tools?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <nav className={cx(styles.rail, isCollapsed && styles["is-collapsed"])} aria-label="워크스페이스 메뉴">
      <div className={styles["rail-section"]}>
        <span className={styles["rail-logo"]}>
          <RailLogoIcon />
        </span>
        <RailDivider />
        <RailGroup>
          {navItems.map(({ id, label, Icon, isActive }) => (
            <RailButton
              key={id}
              label={label}
              isActive={isActive(activeView)}
              aria-current={isActive(activeView) ? "page" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onViewChange(id);
              }}
            >
              <Icon />
            </RailButton>
          ))}
          {/* 알림 (Figma 1486:4958). 안 읽음 점은 알림 화면 탭에서만 보여 준다. */}
          <RailButton
            label="알림"
            isActive={activeView === "notifications"}
            aria-current={activeView === "notifications" ? "page" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onViewChange("notifications");
            }}
          >
            <RailBellIcon />
          </RailButton>
        </RailGroup>
        {tools && (
          <>
            <RailDivider />
            {tools}
          </>
        )}
      </div>
      {footer && <div className={cx(styles["rail-section"], styles["is-bottom"])}>{footer}</div>}
    </nav>
  );
}
