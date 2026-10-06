"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { acquireAssetObjectUrl, releaseAssetObjectUrl } from "@/shared/api/assets";
import { classifyImageSource } from "@/shared/lib/externalResources";

/**
 * Markdown 이미지. 워크스페이스 관리 이미지(/api/workspaces/…/assets/…/content)는
 * Bearer 인증이 필요해 일반 <img src>로는 401이라, JWT fetch → object URL로 표시한다.
 * 외부 주소는 열람만으로 문서 내용·열람자 정보가 새므로 요청하지 않고 도메인만 알린다(이슈 #77).
 * 같은 출처라도 관리 경로가 아닌 src도 요청하지 않는다. data:image·blob:만 그대로 둔다.
 */
export function ManagedImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const source = typeof src === "string" ? src : "";
  const classified = classifyImageSource(source);
  const isManaged = classified.kind === "managed";
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isFailed, setIsFailed] = useState(false);

  useEffect(() => {
    if (!isManaged) return;
    let cancelled = false;
    setObjectUrl(null);
    setIsFailed(false);
    acquireAssetObjectUrl(source)
      .then((url) => { if (!cancelled) setObjectUrl(url); })
      .catch(() => { if (!cancelled) setIsFailed(true); });
    // 마지막 사용처가 사라지면 object URL을 revoke한다
    return () => { cancelled = true; releaseAssetObjectUrl(source); };
  }, [isManaged, source]);

  if (classified.kind === "external") {
    return (
      <span className="markdown-image-blocked" role="img" aria-label={`표시하지 않은 외부 이미지 (${classified.host})`}>
        외부 이미지는 표시하지 않습니다 · {classified.host}
      </span>
    );
  }
  if (classified.kind === "unsupported") {
    // 빈 src는 예전처럼 아무것도 그리지 않는다
    if (!source) return null;
    return <span className="markdown-image-blocked" role="img" aria-label={alt || "이미지"}>표시할 수 없는 이미지입니다</span>;
  }
  if (isManaged && isFailed) return <span className="markdown-image-missing" role="img" aria-label={alt ?? "이미지"}>이미지를 불러오지 못했습니다</span>;
  const resolved = isManaged ? objectUrl : source;
  if (!resolved) return null;
  // eslint-disable-next-line @next/next/no-img-element -- 사용자 업로드 이미지는 크기를 미리 알 수 없어 next/image를 쓰지 않는다
  return <img {...rest} src={resolved} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
}
