import { useMemo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Element } from "hast";
import type { PluggableList } from "unified";
import { cx } from "@/shared/lib/classNames";
import { splitMarkdownBlockRanges } from "@/shared/lib/markdownSegments";
import { createRehypeSourceBlocks } from "@/shared/lib/markdownSourceBlocks";
import { remarkClosedMath } from "@/shared/lib/remarkClosedMath";
import { rankColorClass, remarkCustomTokens } from "@/shared/lib/remarkCustomTokens";
import type { SourceBlockHighlight } from "@/entities/document";
import { ManagedImage } from "@/shared/ui/markdown/ManagedImage";

// 렌더마다 배열 참조가 바뀌면 react-markdown이 재파싱하므로 모듈 상수로 유지한다.
const REMARK_PLUGINS: PluggableList = [
  // "5~7초" 같은 범위 표기가 취소선이 되지 않도록 `~~`만 인정한다.
  [remarkGfm, { singleTilde: false }],
  // 금액의 $는 그대로 표시하고, 수식은 $$...$$로 작성한다.
  [remarkMath, { singleDollarTextMath: false }],
  remarkClosedMath,
  remarkCustomTokens,
];

export function MarkdownViewer({
  markdown,
  onCitationClick,
  canClickCitation,
  citationRankMap,
  citableRanks,
  highlightedBlocks,
  onBlockRef
}: {
  markdown: string;
  onCitationClick?: (rank: number) => void;
  canClickCitation?: (rank: number) => boolean;
  citationRankMap?: ReadonlyMap<number, number>;
  citableRanks?: ReadonlySet<number>;
  highlightedBlocks?: SourceBlockHighlight[];
  onBlockRef?: (blockId: string, node: HTMLDivElement | null) => void;
}) {
  const remarkPlugins = useMemo<PluggableList>(
    () => citationRankMap || citableRanks
      ? [[remarkGfm, { singleTilde: false }], [remarkMath, { singleDollarTextMath: false }], remarkClosedMath, [remarkCustomTokens, { citationRankMap, citableRanks }]]
      : REMARK_PLUGINS,
    [citationRankMap, citableRanks]
  );
  const highlightedBlockRankById = useMemo(
    () => new Map((highlightedBlocks ?? []).map((block) => [block.block_id, block.rank])),
    [highlightedBlocks]
  );
  const sourceBlocks = useMemo(
    () => splitMarkdownBlockRanges(markdown).map((segment, index) => ({
      ...segment,
      blockId: `B${String(index + 1).padStart(4, "0")}`
    })),
    [markdown]
  );
  const bodyMarkdown = useMemo(() => {
    const lines = markdown.split("\n");
    sourceBlocks
      .filter((block) => block.kind === "frontmatter")
      .forEach((block) => {
        for (let line = block.startLine; line <= block.endLine; line += 1) {
          lines[line - 1] = "";
        }
      });
    return lines.join("\n");
  }, [markdown, sourceBlocks]);
  const rehypePlugins = useMemo(
    () => [rehypeKatex, createRehypeSourceBlocks(sourceBlocks)],
    [sourceBlocks]
  );

  const components = useMemo(() => {
    function CitationRef({ rank, children }: { rank?: number; children?: ReactNode }) {
      const citationRank = Number(rank);
      if (!Number.isFinite(citationRank) || !onCitationClick || (canClickCitation && !canClickCitation(citationRank))) {
        return <>{children}</>;
      }
      return (
        <button
          type="button"
          className={`markdown-citation ${rankColorClass(citationRank)}`}
          onClick={(event) => {
            event.stopPropagation();
            onCitationClick(citationRank);
          }}
        >
          {children}
        </button>
      );
    }

    function SourceBlock({ node, children }: { node?: Element; children?: ReactNode }) {
      const blockId = String(node?.properties?.dataBlockId ?? "");
      const highlightedRank = highlightedBlockRankById.get(blockId);

      return (
        <div
          className={cx(
            "markdown-source-block",
            highlightedRank && "is-highlighted",
            highlightedRank && rankColorClass(highlightedRank)
          )}
          data-block-id={blockId}
          data-citation-rank={highlightedRank}
          ref={(element) => onBlockRef?.(blockId, element)}
        >
          {children}
        </div>
      );
    }

    return {
      pre: ({ children }: { children?: ReactNode }) => <pre className="markdown-codeblock">{children}</pre>,
      img: ManagedImage,
      "citation-ref": CitationRef,
      "source-block": SourceBlock
    } as Components;
  }, [canClickCitation, highlightedBlockRankById, onBlockRef, onCitationClick]);

  return (
    <div className="markdown-viewer">
      {sourceBlocks
        .filter((block) => block.kind === "frontmatter")
        .map((block) => {
          const highlightedRank = highlightedBlockRankById.get(block.blockId);
          return (
          <div
            className={cx(
              "markdown-source-block",
              highlightedRank && "is-highlighted",
              highlightedRank && rankColorClass(highlightedRank)
            )}
            data-block-id={block.blockId}
            data-citation-rank={highlightedRank}
            ref={(element) => onBlockRef?.(block.blockId, element)}
            key={block.blockId}
          >
            <details className="markdown-frontmatter">
              <summary>Metadata</summary>
              <pre>{block.content}</pre>
            </details>
          </div>
          );
        })}
      {/* 에디터가 빈 줄 보존용으로 써넣는 <br /> 같은 원본 HTML이 글자로 보이지 않게
          렌더 단계에서만 버린다. 저장된 markdown은 그대로 둔다. */}
      <ReactMarkdown
        skipHtml
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {bodyMarkdown}
      </ReactMarkdown>
    </div>
  );
}
