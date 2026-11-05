import type { RailView } from "@/widgets/rail-navigation/ui/RailNavigation";

/** AgentPanel을 렌더할 수 있는 뷰. 홈과 그래프에서만 채팅 패널을 함께 띄운다. */
export function canShowAgentPanel(view: RailView): boolean {
  return view === "home" || view === "graph";
}

/**
 * 패널이 실제로 화면에 있는가. 렌더 조건과 우측 여백 계산의 단일 기준.
 * 스킬 화면은 스킬 만들기·상세 시트가 열린 동안만 패널을 함께 띄운다(Figma 1671:13573: 테스트 실행이 패널에 있다).
 */
export function isAgentPanelVisible(view: RailView, isOpen: boolean, isSkillSheetOpen = false): boolean {
  return (canShowAgentPanel(view) || (view === "skills" && isSkillSheetOpen)) && isOpen;
}

/**
 * 알림 스택을 어디에 둘지. null이면 띄우지 않는다.
 * 설정·로그는 채팅 패널이 없어 화면 우하단에 둔다. 로그 화면의 롤백 결과는 이 스택으로만 안내한다.
 */
export function noticeStackPlacement(view: RailView): "panel" | "corner" | null {
  if (view === "home" || view === "graph") return "panel";
  return view === "settings" || view === "logs" ? "corner" : null;
}
