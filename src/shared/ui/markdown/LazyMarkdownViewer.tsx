"use client";

import dynamic from "next/dynamic";

/**
 * react-markdown·KaTeX를 묶은 MarkdownViewer를 처음 그릴 때 받는다.
 * 채팅 답변·소스 프리뷰·노트 미리보기가 모두 이 모듈을 쓰므로 청크는 하나만 생긴다.
 * SSR은 그대로 두어 서버 HTML에는 본문이 들어가고, 클라이언트는 청크를 받은 뒤 hydrate한다.
 */
export const MarkdownViewer = dynamic(
  () => import("./MarkdownViewer").then((module) => module.MarkdownViewer),
  { loading: () => <div className="markdown-viewer" aria-busy="true" /> }
);
