"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaceIcon } from "../api/workspace";
import type { WorkspaceResponse } from "../model/workspace";

/**
 * 워크스페이스 아이콘: 업로드한 이미지, 없으면 글자.
 * hideEmoji: 설정·사이드바 상단처럼 시안이 이름 첫 글자만 보여 주는 자리에서 예전 이모티콘(icon_emoji) 대신 첫 글자를 쓴다.
 */
export function WorkspaceIcon({ workspace, className, hideEmoji = false }: {
  workspace: WorkspaceResponse | null;
  className?: string;
  hideEmoji?: boolean;
}) {
  const fallbackText = (hideEmoji ? null : workspace?.icon_emoji) || workspace?.name.charAt(0) || "워";
  const { data: blob, error } = useQuery({
    queryKey: ["workspace-icon", workspace?.id, workspace?.updated_at],
    queryFn: () => fetchWorkspaceIcon(workspace!.id),
    enabled: Boolean(workspace?.icon_url),
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

  return <span className={className} aria-hidden title={error ? "아이콘 이미지를 불러오지 못했습니다." : undefined}>
    {workspace?.icon_url && image?.blob === blob && image ? (
      // 인증이 필요한 이미지는 Bearer 요청으로 받은 Blob URL을 사용한다.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
    ) : fallbackText}
  </span>;
}
