import { useTranslations } from "next-intl";
import { documentAccessMessageKey } from "@/entities/document/lib/documentAccess";
import { treePermissionMessageKey } from "../lib/treePermission";
import { treeSkipReasonKey } from "../lib/treeSkipReasons";

/**
 * 권한 판정 모듈이 이유로 넘기는 문구(treePermission·documentAccess 상수)와 묶음 이동·삭제의 건너뜀 이유(treeSkipReasons)를
 * 지금 언어로 옮긴다. 그 밖의 문구(서버 원문 등)는 그대로 둔다.
 */
export function useTreeReasonText(): (reason: string) => string {
  const t = useTranslations("documents");
  return (reason) => {
    const accessKey = treePermissionMessageKey(reason) ?? documentAccessMessageKey(reason);
    if (accessKey) return t(`access.${accessKey}`);
    const skipKey = treeSkipReasonKey(reason);
    return skipKey ? t(`tree.skipReason.${skipKey}`) : reason;
  };
}
