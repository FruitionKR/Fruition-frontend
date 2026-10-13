import { useLayoutEffect, useState } from "react";
import { getCompactAgentPanelWidth } from "../lib/panelResize";

/**
 * 좁은 화면 여부와 그때 겹쳐 여는 채팅 패널 폭. 넓은 화면이면 null이다.
 * 값이 같으면 React가 리렌더를 건너뛰므로 넓은 창에서는 resize마다 그리지 않는다.
 * 첫 렌더는 SSR과 같은 넓은 화면 값이고, 마운트 직후(페인트 전) 실제 창 폭으로 맞춘다.
 */
export function useCompactLayout(): number | null {
  const [compactAgentPanelWidth, setCompactAgentPanelWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const sync = () => setCompactAgentPanelWidth(getCompactAgentPanelWidth(window.innerWidth));
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return compactAgentPanelWidth;
}
