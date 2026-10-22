import { useEffect } from "react";
import { formatWorkspaceDocumentTitle } from "../lib/workspaceLocation";

/**
 * 브라우저 탭 제목은 문서·화면과 관계없이 Fruition으로 유지한다.
 * 클라이언트 이동이 끝나면 Next가 metadata 제목을 다시 적용하므로, URL이 바뀔 때도 다음 프레임에 덮어쓴다.
 */
export function useWorkspaceDocumentTitle(screenTitle: string | null, locationKey: string) {
  useEffect(() => {
    const title = formatWorkspaceDocumentTitle(screenTitle);
    document.title = title;
    const frameId = requestAnimationFrame(() => {
      document.title = title;
    });
    return () => {
      cancelAnimationFrame(frameId);
      document.title = formatWorkspaceDocumentTitle(null);
    };
  }, [screenTitle, locationKey]);
}
