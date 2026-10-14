"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchUserAvatar } from "../api/account";
import { avatarInitial } from "../lib/avatarFile";

/**
 * 사용자 프로필 사진. avatar_url(GET /api/users/{id}/avatar?v=hash)은 Bearer가 필요해 <img src>로 못 쓰므로
 * 워크스페이스 아이콘과 같이 fetch → object URL로 보여 준다. URL의 ?v=가 바뀌면 키가 달라져 새 이미지를 받는다.
 * avatar_url이 없거나 못 받으면 이름 첫 글자 상자로 돌아간다. 크기·모양은 className이 정한다.
 */
export function UserAvatar({ avatarUrl, name, className }: { avatarUrl: string | null | undefined; name: string | null | undefined; className?: string }) {
  const { data: blob, error } = useQuery({
    queryKey: ["user-avatar", avatarUrl],
    queryFn: () => fetchUserAvatar(avatarUrl!),
    enabled: Boolean(avatarUrl),
    staleTime: Infinity,
    retry: false
  });
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return <span className={className} aria-hidden title={error ? "프로필 사진을 불러오지 못했습니다." : undefined}>
    {avatarUrl && image?.blob === blob && image ? (
      // 인증이 필요한 이미지는 Bearer 요청으로 받은 Blob URL을 사용한다.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
    ) : avatarInitial(name)}
  </span>;
}
