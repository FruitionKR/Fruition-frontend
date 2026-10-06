import type { PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

// citation 강조에 사용하는 색상 팔레트 개수
const CITATION_COLOR_COUNT = 5;

export function rankColorClass(rank: number) {
  return `citation-rank-${((rank - 1) % CITATION_COLOR_COUNT) + 1}`;
}

/**
 * wikilink([[...]])와 citation([1,2])을 커스텀 노드로 분리하는 remark 플러그인.
 * 숫자 괄호는 안의 숫자가 모두 citableRanks(응답 references의 원래 rank)에 있을 때만 citation으로 바꾸고,
 * 아니면 `[5, 2, 4]` 같은 배열일 수 있으므로 원문을 그대로 둔다.
 */
export function remarkCustomTokens(options?: {
  citationRankMap?: ReadonlyMap<number, number>;
  citableRanks?: ReadonlySet<number>;
}) {
  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;

      const pattern = /(\[\[[^\]|]+(?:\|[^\]]+)?\]\]|\[(?:\d+)(?:\s*,\s*\d+)*\](?:[ \t]*\[(?:\d+)(?:\s*,\s*\d+)*\])*)/g;
      const value = node.value;
      const replacements: PhrasingContent[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(value)) !== null) {
        const token = match[0];
        const isWikiLink = token.startsWith("[[");
        const numbers = isWikiLink ? [] : (token.match(/\d+/g) ?? []).map(Number);
        // citation이 아닌 숫자 괄호는 lastIndex를 그대로 두어 앞뒤 텍스트와 함께 원문으로 남긴다.
        if (!isWikiLink && !numbers.every((rank) => options?.citableRanks?.has(rank))) continue;

        if (match.index > lastIndex) {
          replacements.push({ type: "text", value: value.slice(lastIndex, match.index) });
        }

        if (isWikiLink) {
          const body = token.slice(2, -2);
          const label = body.includes("|") ? body.split("|")[1] : body;
          // 커스텀 노드 타입이라 mdast 유니온에 없어 캐스팅한다. hName 기반으로 hast에서 span으로 변환된다.
          replacements.push({
            type: "wikiLinkToken",
            data: { hName: "span", hProperties: { className: "markdown-wikilink" } },
            children: [{ type: "text", value: label }]
          } as unknown as PhrasingContent);
        } else {
          const ranks = [...new Set(numbers.map((rank) => options?.citationRankMap?.get(rank) ?? rank))];
          ranks.forEach((rank) => {
            replacements.push({
              type: "citationToken",
              data: { hName: "citation-ref", hProperties: { rank } },
              children: [{ type: "text", value: `[${rank}]` }]
            } as unknown as PhrasingContent);
          });
        }

        lastIndex = match.index + token.length;
      }

      if (replacements.length === 0) return;
      if (lastIndex < value.length) {
        replacements.push({ type: "text", value: value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
}
