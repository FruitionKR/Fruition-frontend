import { useEffect, useRef, useState } from "react";
import type { FolderOrganizeRequest } from "@/features/agent-chat/lib/folderOrganize";

/**
 * 폴더 정리 스킬 결과 미리보기 탭(Figma 1656:11542). 문서 화면 위에 띄우고, 사용자가 다른 문서·화면으로
 * 옮겨 가면 닫는다. 다른 화면에서 열면 문서 화면으로 먼저 돌아간다.
 */
export function useFolderOrganizePreview({
  locationKey,
  isHomeView,
  goHome
}: {
  locationKey: string;
  isHomeView: boolean;
  goHome: () => void;
}) {
  const [request, setRequest] = useState<FolderOrganizeRequest | null>(null);
  // 미리보기를 열며 문서 화면으로 옮겨 가는 이동은 닫는 이동으로 치지 않는다.
  const isOpeningRef = useRef(false);

  useEffect(() => {
    if (isOpeningRef.current) {
      isOpeningRef.current = false;
      return;
    }
    setRequest(null);
  }, [locationKey]);

  function open(next: FolderOrganizeRequest) {
    setRequest(next);
    if (!isHomeView) {
      isOpeningRef.current = true;
      goHome();
    }
  }

  /** 열려 있는 미리보기가 대체된 계획이면 새 계획으로 바꾼다. 다른 계획을 보고 있거나 닫혀 있으면 그대로 둔다. */
  function replaceSuperseded(supersededTurnId: string, next: FolderOrganizeRequest) {
    setRequest((current) => (current?.turnId === supersededTurnId ? next : current));
  }

  return { request, open, replaceSuperseded, close: () => setRequest(null) };
}
