import type { MutableRefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useUserPreferences } from "@/entities/user";
import type { GraphIngestProgressInput } from "@/features/wiki-ingest/model/graphIngestProgressInputs";
import { ingestProgressByNodeId, reconcileIngestProgress, type IngestProgressEntries } from "../lib/graphIngestProgress";

/** 동작 줄이기에서는 매 프레임 대신 이 간격(ms)으로 값만 갱신한다. */
const REDUCED_MOTION_UPDATE_MS = 1_000;

/**
 * 생성 중 노드의 연출형 진행률을 관리한다.
 * "이전에 처리 중이던 문서"를 기억해 완료 전환을 감지하고, 진행 중 항목이 있을 때만
 * requestAnimationFrame 루프를 돌려 시뮬레이션이 멈춰 있어도 캔버스를 다시 그린다.
 * 반환하는 ref의 맵(nodeId → 0~1)을 그리기에서 읽는다.
 */
export function useGraphIngestProgress({
  inputs,
  drawGraphRef
}: {
  inputs: readonly GraphIngestProgressInput[];
  drawGraphRef: MutableRefObject<() => void>;
}): MutableRefObject<Map<string, number>> {
  const { reduceMotion } = useUserPreferences();
  const entriesRef = useRef<IngestProgressEntries>({});
  const progressRef = useRef<Map<string, number>>(new Map());
  const inputsRef = useRef(inputs);
  // render 중 ref 할당을 피하고, 루프가 항상 최신 문서 상태를 읽게 한다.
  useLayoutEffect(() => {
    inputsRef.current = inputs;
  });

  // 폴링마다 배열이 새로 와도 내용이 같으면 루프를 다시 시작하지 않는다.
  const inputSignature = useMemo(
    () => inputs.map((input) => `${input.nodeId}:${input.status}:${input.status === "processing" ? input.startedAt ?? "" : ""}`).join("|"),
    [inputs]
  );

  useEffect(() => {
    let frameId = 0;
    let timeoutId = 0;

    const step = () => {
      frameId = 0;
      timeoutId = 0;
      const now = Date.now();
      entriesRef.current = reconcileIngestProgress(entriesRef.current, inputsRef.current, now, { reduceMotion });
      progressRef.current = ingestProgressByNodeId(entriesRef.current, now);
      drawGraphRef.current();
      // 진행 중 항목이 없으면 루프를 멈춘다(마지막 그리기로 일반 노드 복귀).
      if (progressRef.current.size === 0) return;
      if (reduceMotion) timeoutId = window.setTimeout(step, REDUCED_MOTION_UPDATE_MS);
      else frameId = requestAnimationFrame(step);
    };

    const hadEntries = Object.keys(entriesRef.current).length > 0;
    if (hadEntries || inputsRef.current.some((input) => input.status === "processing")) step();

    return () => {
      if (frameId !== 0) cancelAnimationFrame(frameId);
      if (timeoutId !== 0) window.clearTimeout(timeoutId);
    };
  }, [drawGraphRef, inputSignature, reduceMotion]);

  return progressRef;
}
