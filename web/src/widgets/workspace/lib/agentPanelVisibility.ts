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
