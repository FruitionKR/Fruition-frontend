/** 줄 단위 diff 한 줄. context는 양쪽에 같은 줄, delete는 지운 줄, insert는 새 줄이다. */
export type MarkdownDiffLine = {
  type: "context" | "delete" | "insert";
  text: string;
};

/** LCS 표가 이 칸 수를 넘으면(아주 긴 본문) 계산을 건너뛰고 전부 지움·추가로 보여 준다. */
const MAX_LCS_CELLS = 250_000;

/** 두 본문의 줄 단위 diff(LCS). 바뀐 줄만 delete·insert이고 같은 줄은 context로 남는다. */
export function lineDiff(before: string, after: string): MarkdownDiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length * afterLines.length > MAX_LCS_CELLS) {
    return [
      ...beforeLines.map((text) => ({ type: "delete" as const, text })),
      ...afterLines.map((text) => ({ type: "insert" as const, text }))
    ];
  }
  const lengths = Array.from(
    { length: beforeLines.length + 1 },
    () => Array<number>(afterLines.length + 1).fill(0)
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
    }
  }

  const diff: MarkdownDiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      diff.push({ type: "context", text: beforeLines[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1]) {
      diff.push({ type: "delete", text: beforeLines[beforeIndex] });
      beforeIndex += 1;
    } else {
      diff.push({ type: "insert", text: afterLines[afterIndex] });
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) {
    diff.push({ type: "delete", text: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    diff.push({ type: "insert", text: afterLines[afterIndex] });
    afterIndex += 1;
  }
  return diff;
}
