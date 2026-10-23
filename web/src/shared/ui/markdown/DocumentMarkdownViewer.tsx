"use client";

import { useEffect, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { afterPaint } from "@/shared/lib/afterPaint";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";
import type { MarkdownViewer as MarkdownViewerComponent } from "./MarkdownViewer";

function RenderingNotice() {
  return (
    <DocumentLoading inline detail="내용이 많거나 표·수식이 포함된 문서는 준비에 시간이 걸릴 수 있습니다.">
      문서를 화면에 표시할 준비를 하고 있습니다.
    </DocumentLoading>
  );
}

type Props = ComponentProps<typeof MarkdownViewerComponent> & { onReady?: () => void };

const Viewer = dynamic<Props>(() => import("./MarkdownViewer").then((module) => {
  return function LoadedDocumentMarkdown({ onReady, ...props }: Props) {
    // 동적 청크 로드와 본문 DOM 반영이 끝난 뒤에만 근거 위치 이동 등을 허용한다.
    useEffect(() => { onReady?.(); }, [props.markdown, onReady]);
    return <module.MarkdownViewer {...props} />;
  };
}), {
  loading: RenderingNotice
});

/** 전체 본문은 그대로 유지한다. 파싱 전에 안내를 먼저 그려 긴 동기 렌더링도 빈 화면으로 보이지 않게 한다. */
export function DocumentMarkdownViewer(props: Props) {
  const [preparedMarkdown, setPreparedMarkdown] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void afterPaint().then(() => {
      if (!disposed) setPreparedMarkdown(props.markdown);
    });
    return () => { disposed = true; };
  }, [props.markdown]);

  if (preparedMarkdown !== props.markdown) return <RenderingNotice />;
  return <Viewer {...props} />;
}
