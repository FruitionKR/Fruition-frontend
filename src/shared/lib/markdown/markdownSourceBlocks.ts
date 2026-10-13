import type { Element, ElementContent, Root, RootContent } from "hast";
import type { MarkdownSegmentRange } from "./markdownSegments";

export type MarkdownSourceBlock = MarkdownSegmentRange & { blockId: string };

/** 서버 block의 현재 본문 기준 줄 범위(1부터, 양끝 포함). */
export type SourceBlockRange = { blockId: string; startLine: number; endLine: number };

/** 한 래퍼가 여러 서버 block을 덮을 수 있어 ID를 공백으로 잇는다. 서버 block ID에는 공백이 없다. */
export const SOURCE_BLOCK_ID_SEPARATOR = " ";

function sourceBlockIdAtLine(blocks: MarkdownSourceBlock[], line: number) {
  return blocks.find((block) => block.startLine <= line && line <= block.endLine)?.blockId;
}

/** 줄 구간과 겹치는 서버 block ID들. 없으면 undefined. */
export function overlappingSourceBlockId(ranges: SourceBlockRange[], startLine: number, endLine: number) {
  const ids = [...new Set(
    ranges
      .filter((range) => range.startLine <= endLine && startLine <= range.endLine)
      .map((range) => range.blockId)
  )];
  return ids.length > 0 ? ids.join(SOURCE_BLOCK_ID_SEPARATOR) : undefined;
}

function isFootnoteSection(node: RootContent): node is Element {
  return node.type === "element"
    && node.tagName === "section"
    && Boolean(node.properties?.dataFootnotes);
}

function createSourceBlockElement(blockId: string, children: ElementContent[]): Element {
  return {
    type: "element",
    tagName: "source-block",
    properties: { dataBlockId: blockId },
    children
  };
}

/**
 * 문서 전체 parse 문맥을 유지하면서 최상위 렌더 노드를 source block ID로 감싼다.
 * 서버 block 범위(highlightRanges)와 겹치는 노드는 그 서버 ID를, 나머지는 로컬 분할 ID를 쓴다.
 */
export function createRehypeSourceBlocks(blocks: MarkdownSourceBlock[], highlightRanges: SourceBlockRange[] = []) {
  function blockIdForLines(startLine: number, endLine: number) {
    return overlappingSourceBlockId(highlightRanges, startLine, endLine) ?? sourceBlockIdAtLine(blocks, startLine);
  }

  return function rehypeSourceBlocks() {
    return (tree: Root) => {
      const footnoteBlock = blocks.find(
        (block) => block.kind === "markdown" && /(?:^|\n)\[\^[^\]]+\]:/.test(block.content)
      );
      const footnoteBlockId = footnoteBlock && blockIdForLines(footnoteBlock.startLine, footnoteBlock.endLine);
      const wrappedChildren: RootContent[] = [];

      tree.children.forEach((child) => {
        if (child.type === "doctype") {
          wrappedChildren.push(child);
          return;
        }

        const blockId = child.position?.start.line
          ? blockIdForLines(child.position.start.line, child.position.end.line)
          : isFootnoteSection(child)
            ? footnoteBlockId
            : undefined;

        if (!blockId) {
          const lastChild = wrappedChildren.at(-1);
          if (lastChild?.type === "element" && lastChild.tagName === "source-block") {
            lastChild.children.push(child);
          } else {
            wrappedChildren.push(child);
          }
          return;
        }

        const lastChild = wrappedChildren.at(-1);
        if (
          lastChild?.type === "element"
          && lastChild.tagName === "source-block"
          && lastChild.properties?.dataBlockId === blockId
        ) {
          lastChild.children.push(child);
          return;
        }

        wrappedChildren.push(createSourceBlockElement(blockId, [child]));
      });

      tree.children = wrappedChildren;
    };
  };
}
