import { useTranslations } from "next-intl";
import { documentAccessMessageKey } from "@/entities/document/lib/documentAccess";
import { treePermissionMessageKey } from "../lib/treePermission";

/**
 * 권한 판정 모듈이 이유로 넘기는 문구(treePermission·documentAccess 상수)를 지금 언어로 옮긴다.
 * 그 밖의 문구(서버 원문 등)는 그대로 둔다.
 */
export function useTreeReasonText(): (reason: string) => string {
  const t = useTranslations("documents.access");
  return (reason) => {
    const key = treePermissionMessageKey(reason) ?? documentAccessMessageKey(reason);
    return key ? t(key) : reason;
  };
}
