export type TaskAnswerBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

const LIST_ITEM = /^- (.*)$/;

/**
 * 작업 탭 답변(folder_lookup message)을 빈 줄로 나눈 문단과 `- ` 목록으로 나눈다.
 * 글자는 해석하지 않고 그대로 두어 React가 텍스트로만 그린다(HTML·Markdown 기호 무시).
 */
export function taskAnswerBlocks(message: string): TaskAnswerBlock[] {
  const blocks: TaskAnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };
  for (const line of message.split("\n")) {
    const text = line.trimEnd();
    const item = LIST_ITEM.exec(text.trimStart());
    if (!text.trim()) {
      flush();
    } else if (item) {
      if (paragraph.length > 0) flush();
      list = [...list, item[1]];
    } else {
      if (list.length > 0) flush();
      paragraph = [...paragraph, text.trim()];
    }
  }
  flush();
  return blocks;
}
