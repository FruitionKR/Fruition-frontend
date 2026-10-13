import { cx } from "@/shared/lib/classNames";
import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";
import styles from "./DocumentSidebar.module.css";

// Figma 1486:4403 — 사이드바 상단 문서/그래프 세그먼트. 홈 레일 아래 두 화면을 전환한다.
const segments: { id: RailView; label: string; hint: string }[] = [
  { id: "home", label: "문서", hint: "문서를 열어 읽고 편집하는 홈 화면으로 이동합니다." },
  { id: "graph", label: "그래프", hint: "위키 그래프를 보고 문서를 편입·최신화합니다." }
];

/** 문서/그래프 전환 세그먼트. 로그·스킬 등 다른 화면에서는 어느 쪽도 선택되지 않는다. */
export function SidebarMenuRow({
  activeView,
  onViewChange
}: {
  activeView: RailView;
  onViewChange: (view: RailView) => void;
}) {
  return (
    <div className={styles["sidebar-segment"]} role="group" aria-label="문서 화면 전환">
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          className={cx(styles["sidebar-segment-item"], activeView === segment.id && styles["is-active"])}
          aria-pressed={activeView === segment.id}
          title={segment.hint}
          onClick={(event) => {
            event.stopPropagation();
            onViewChange(segment.id);
          }}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
