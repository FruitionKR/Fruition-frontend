import { useCallback, useMemo } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Element } from "hast";
import type { PluggableList } from "unified";
import { cx } from "@/shared/lib/classNames";
import { splitMarkdownBlockRanges } from "@/shared/lib/markdownSegments";
import {
  createRehypeSourceBlocks,
  overlappingSourceBlockId,
  SOURCE_BLOCK_ID_SEPARATOR,
  type SourceBlockRange
} from "@/shared/lib/markdownSourceBlocks";
import { remarkClosedMath } from "@/shared/lib/remarkClosedMath";
import { rankColorClass, remarkCustomTokens } from "@/shared/lib/remarkCustomTokens";
import { classifyLinkHref } from "@/shared/lib/externalResources";
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

/**
 * 외부 링크 처리 방식.
 * - default: 사용자가 쓴 문서. 그대로 클릭할 수 있되 Referer·opener를 넘기지 않는다.
 * - inert-external: AI가 만든 본문. 프롬프트 주입으로 넣은 피싱·유출 링크를 누르지 않도록 글자와 도메인만 보여준다(이슈 #77).
 */
export type MarkdownLinkPolicy = "default" | "inert-external";

function createMarkdownLink(linkPolicy: MarkdownLinkPolicy) {
  return function MarkdownLink({ href, children, node: _node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
    const target = classifyLinkHref(href);
    if (!target.external) return <a {...rest} href={href}>{children}</a>;
    if (linkPolicy === "inert-external") {
      return <span className="markdown-inert-link">{children}{target.host && ` (${target.host})`}</span>;
    }
    return <a {...rest} href={href} rel="noopener noreferrer">{children}</a>;
  };
}

const DEFAULT_LINK = createMarkdownLink("default");
const INERT_EXTERNAL_LINK = createMarkdownLink("inert-external");

export function MarkdownViewer({
  markdown,
  linkPolicy = "default",
  onCitationClick,
  canClickCitation,
  citationRankMap,
  citableRanks,
  highlightedBlocks,
  highlightRanges,
  onBlockRef
}: {
  markdown: string;
  linkPolicy?: MarkdownLinkPolicy;
  onCitationClick?: (rank: number) => void;
  canClickCitation?: (rank: number) => boolean;
  citationRankMap?: ReadonlyMap<number, number>;
  citableRanks?: ReadonlySet<number>;
  highlightedBlocks?: SourceBlockHighlight[];
  /** 서버 block ID의 현재 본문 줄 범위. 주어지면 이 범위와 겹치는 노드에 서버 ID를 붙인다. */
  highlightRanges?: SourceBlockRange[];
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
  // 로컬 분할 ID는 렌더 래핑용이다. 서버 범위를 쓸 때는 서버 block ID와 겹치지 않게 접두어를 붙인다.
  const localIdPrefix = highlightRanges ? "local-" : "";
  const sourceBlocks = useMemo(
    () => splitMarkdownBlockRanges(markdown).map((segment, index) => ({
      ...segment,
      blockId: `${localIdPrefix}B${String(index + 1).padStart(4, "0")}`
    })),
    [localIdPrefix, markdown]
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
    () => [rehypeKatex, createRehypeSourceBlocks(sourceBlocks, highlightRanges)],
    [highlightRanges, sourceBlocks]
  );

  // 래퍼 하나가 서버 block 여러 개를 덮으면 ID가 공백으로 이어져 있다.
  const highlightedRankOf = useCallback(
    (blockId: string) => blockId
      .split(SOURCE_BLOCK_ID_SEPARATOR)
      .map((id) => highlightedBlockRankById.get(id))
      .find((rank) => rank !== undefined),
    [highlightedBlockRankById]
  );
  const registerBlockRef = useCallback(
    (blockId: string, element: HTMLDivElement | null) => {
      blockId.split(SOURCE_BLOCK_ID_SEPARATOR).forEach((id) => onBlockRef?.(id, element));
    },
    [onBlockRef]
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
      const highlightedRank = highlightedRankOf(blockId);

      return (
        <div
          className={cx(
            "markdown-source-block",
            highlightedRank && "is-highlighted",
            highlightedRank && rankColorClass(highlightedRank)
          )}
          data-block-id={blockId}
          data-citation-rank={highlightedRank}
          ref={(element) => registerBlockRef(blockId, element)}
        >
          {children}
        </div>
      );
    }

    return {
      pre: ({ children }: { children?: ReactNode }) => <pre className="markdown-codeblock">{children}</pre>,
      img: ManagedImage,
      a: linkPolicy === "inert-external" ? INERT_EXTERNAL_LINK : DEFAULT_LINK,
      "citation-ref": CitationRef,
      "source-block": SourceBlock
    } as Components;
  }, [canClickCitation, highlightedRankOf, linkPolicy, onCitationClick, registerBlockRef]);

  return (
    <div className="markdown-viewer">
      {sourceBlocks
        .filter((block) => block.kind === "frontmatter")
        .map((block) => {
          const blockId = (highlightRanges && overlappingSourceBlockId(highlightRanges, block.startLine, block.endLine))
            ?? block.blockId;
          const highlightedRank = highlightedRankOf(blockId);
          return (
          <div
            className={cx(
              "markdown-source-block",
              highlightedRank && "is-highlighted",
              highlightedRank && rankColorClass(highlightedRank)
            )}
            data-block-id={blockId}
            data-citation-rank={highlightedRank}
            ref={(element) => registerBlockRef(blockId, element)}
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
