import { useCallback, useState, type SetStateAction } from "react";
import { panelDraftStorageKey, type ChatChannel } from "@/features/agent-chat/lib/panelSessionState";

function readDraft(key: string | null): string {
  if (!key || typeof window === "undefined") return "";
  try { return window.sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

/** 세션별 입력 초안. 다른 탭으로 이동·새로고침해도 본문이 서로 섞이지 않는다. */
export function usePanelDraft(scope: string | null, view: ChatChannel, sessionId: string | null) {
  const key = scope && sessionId ? panelDraftStorageKey(scope, view, sessionId) : null;
  const [draft, setDraft] = useState<{ key: string | null; value: string }>({ key: null, value: "" });
  const value = draft.key === key ? draft.value : readDraft(key);
  const setValue = useCallback((update: SetStateAction<string>) => {
    setDraft(current => {
      const previous = current.key === key ? current.value : readDraft(key);
      const next = typeof update === "function" ? update(previous) : update;
      if (key) {
        try {
          if (next) window.sessionStorage.setItem(key, next);
          else window.sessionStorage.removeItem(key);
        } catch { /* 브라우저 저장이 막혀도 현재 입력은 유지한다. */ }
      }
      return { key, value: next };
    });
  }, [key]);
  return { value, setValue };
}
