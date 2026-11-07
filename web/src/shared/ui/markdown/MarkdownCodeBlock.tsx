"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Element } from "hast";
import { codeBlockCopyText, codeBlockLanguage, codeBlockLineCount, hastText } from "@/shared/lib/markdown/codeBlock";

/** 복사 결과 문구를 보여 준 뒤 Copy로 돌아가기까지의 시간 */
const COPY_FEEDBACK_MS = 1500;

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL_KEYS = { idle: "ui.codeBlock.copy", copied: "ui.codeBlock.copied", failed: "ui.codeBlock.copyFailed" } as const;
const COPY_ANNOUNCEMENT_KEYS = { copied: "ui.codeBlock.copiedAnnouncement", failed: "ui.codeBlock.copyFailedAnnouncement" } as const;

/** 편집기(Crepe) Copy 버튼과 같은 아이콘 */
function CopyIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 -960 960 960">
      <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
    </svg>
  );
}

/**
 * 문서 보기의 코드 블록. 편집기 코드 블록과 같은 모양으로 언어 라벨·Copy 버튼·줄 번호를 그린다.
 * 줄 번호는 스크롤 영역 밖에 두어 긴 줄을 가로로 밀어도 제자리에 있고, 선택·복사에 섞이지 않는다.
 */
export function MarkdownCodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const codeNode = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  const language = codeBlockLanguage(codeNode?.properties?.className);
  const copyText = codeBlockCopyText(hastText(codeNode));
  const lineCount = codeBlockLineCount(copyText);

  const t = useTranslations("shared");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copyCode() {
    let next: CopyState = "copied";
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(copyText);
    } catch {
      next = "failed";
    }
    setCopyState(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }

  return (
    <div className="markdown-codeblock" data-language={language}>
      <div className="markdown-codeblock-tools">
        <span className="markdown-codeblock-tool markdown-codeblock-language">{language}</span>
        <button
          type="button"
          className="markdown-codeblock-tool markdown-codeblock-copy"
          data-state={copyState}
          aria-label={t("ui.codeBlock.copyLabel")}
          onClick={() => void copyCode()}
        >
          <CopyIcon />
          {t(COPY_LABEL_KEYS[copyState])}
        </button>
        <span className="markdown-codeblock-status" role="status">{copyState === "idle" ? "" : t(COPY_ANNOUNCEMENT_KEYS[copyState])}</span>
      </div>
      <div className="markdown-codeblock-body">
        <div className="markdown-codeblock-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <pre className="markdown-codeblock-scroll">{children}</pre>
      </div>
    </div>
  );
}
