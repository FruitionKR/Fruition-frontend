import type { Root } from "mdast";
import type { VFile } from "vfile";
import { visit } from "unist-util-visit";

/** remark-math가 EOF까지 수식으로 해석한 미완성 블록을 원문 텍스트로 되돌린다. */
export function remarkClosedMath() {
  return (tree: Root, file: VFile) => {
    const markdown = String(file);
    visit(tree, "math", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = markdown.slice(start, end);
      const lines = source.split(/\r?\n/);
      const opening = lines[0].match(/^\$\$+(?=\s|$)/)?.[0];
      const closing = lines.at(-1)?.match(/^[\t ]*(?:>[\t ]*)*(\${2,})[\t ]*$/)?.[1];
      if (lines.length > 1 && opening && closing && closing.length >= opening.length) return;
      parent.children.splice(index, 1, {
        type: "paragraph",
        position: node.position,
        children: [{ type: "text", value: source }]
      });
    });
  };
}
