"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Element } from "hast";
import { MarkdownCodeBlock } from "@/shared/ui/markdown/MarkdownCodeBlock";
import styles from "./TutorialDialog.module.css";

/** 같은 이름으로 다시 추가하면 기존 항목과 헷갈리지 않도록 서버 이름을 하나로 고정한다. */
const SERVER_NAME = "fruition";

/** Codex·Claude Code에 붙여 넣을 명령. 주소는 서버 설정 값을 그대로 쓴다. */
export function mcpServerCommands(endpoint: string) {
  return {
    codex: [`codex mcp add ${SERVER_NAME} --url '${endpoint}'`, `codex mcp login ${SERVER_NAME}`, "codex mcp list"].join("\n"),
    claude: `claude mcp add --transport http ${SERVER_NAME} '${endpoint}'`
  };
}

function CommandBlock({ text }: { text: string }) {
  // 문서 보기 코드 블록과 같은 Copy 버튼·모양을 쓰려고 같은 구조의 노드를 넘긴다.
  const node = { type: "element", tagName: "pre", properties: {}, children: [{ type: "element", tagName: "code",
    properties: { className: ["language-shell"] }, children: [{ type: "text", value: text }] }] } as Element;
  return <MarkdownCodeBlock node={node}><code>{text}</code></MarkdownCodeBlock>;
}

/** 튜토리얼 'MCP 서버 추가하기' 단계 아래에 실제 주소와 클라이언트별 명령을 보여 준다. */
export function McpServerCommands() {
  const t = useTranslations("tutorial.ui.mcp");
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    fetch("/api/mcp-endpoint", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { endpoint: null })
      .then((body: { endpoint?: unknown }) => { if (active) setEndpoint(typeof body.endpoint === "string" ? body.endpoint : null); })
      .catch(() => { if (active) setEndpoint(null); });
    return () => { active = false; };
  }, []);

  if (endpoint === undefined) return <p className={styles["step-body"]} role="status">{t("loading")}</p>;
  if (endpoint === null) return <p className={styles["step-body"]} role="status">{t("unavailable")}</p>;
  const commands = mcpServerCommands(endpoint);
  return <div className={styles["step-body"]}>
    <p>{t("address")}</p>
    <CommandBlock text={endpoint} />
    <p>{t("codex")}</p>
    <CommandBlock text={commands.codex} />
    <p>{t("claude")}</p>
    <CommandBlock text={commands.claude} />
  </div>;
}
