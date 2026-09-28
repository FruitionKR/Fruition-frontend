"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { fetchAssetObjectUrl, isManagedAssetPath } from "@/shared/api/assets";

/**
 * Markdown 이미지. 워크스페이스 관리 이미지(/api/workspaces/…/assets/…/content)는
 * Bearer 인증이 필요해 일반 <img src>로는 401이라, JWT fetch → object URL로 표시한다.
 * data:·https: 등 다른 src는 그대로 둔다.
 */
export function ManagedImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const source = typeof src === "string" ? src : "";
  const isManaged = isManagedAssetPath(source);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isFailed, setIsFailed] = useState(false);

  useEffect(() => {
    if (!isManaged) return;
    let cancelled = false;
    setObjectUrl(null);
    setIsFailed(false);
    fetchAssetObjectUrl(source)
      .then((url) => { if (!cancelled) setObjectUrl(url); })
      .catch(() => { if (!cancelled) setIsFailed(true); });
    return () => { cancelled = true; };
  }, [isManaged, source]);

  if (isManaged && isFailed) return <span className="markdown-image-missing" role="img" aria-label={alt ?? "이미지"}>이미지를 불러오지 못했습니다</span>;
  const resolved = isManaged ? objectUrl : source;
  if (!resolved) return null;
  // eslint-disable-next-line @next/next/no-img-element -- 사용자 업로드 이미지는 크기를 미리 알 수 없어 next/image를 쓰지 않는다
  return <img {...rest} src={resolved} alt={alt ?? ""} loading="lazy" />;
}
