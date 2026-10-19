"use client";

import { GraphFilterChips } from "@/widgets/graph/ui/GraphFilterChips";

const noop = () => {};
const ALL_VISIBLE = { raw: true, source: true, concept: true } as const;

/** 실제 그래프 범례 칩을 그대로 쓴다. 칩이 버튼(onClick)이라 클라이언트 컴포넌트로 감싸고, 미리보기에서는 동작하지 않는다(inert). */
export function PreviewGraphChips({ raw, source, concept }: { raw: number; source: number; concept: number }) {
  return (
    <GraphFilterChips
      rawDocumentCount={raw}
      sourceNodeCount={source}
      conceptNodeCount={concept}
      visibleKinds={ALL_VISIBLE}
      onToggleKind={noop}
    />
  );
}
