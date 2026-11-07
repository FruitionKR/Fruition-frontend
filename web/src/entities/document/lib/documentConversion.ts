import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting } from "./documentKind";

/** 변환 중인 Markdown(변환 결과 placeholder)을 열었을 때 보여 줄 상태. */
export type DocumentConversionView = {
  /** processing_stage에서 읽은 진행률(3/10페이지면 { current: 3, total: 10 }). 알 수 없으면 null. */
  progress: { current: number; total: number } | null;
  /** heartbeat가 끊겨 변환이 멈춘 상태(processing_state === "stalled") */
  stalled: boolean;
  /** 묶음이 추가될 때마다 바뀌는 값. 바뀌면 열린 본문을 다시 불러온다. */
  revision: string;
};

type ConversionSource = Pick<DocumentItemResponse, "status" | "pipeline_run_id" | "processing_state" | "processing_stage" | "updated_at">;

/** 백엔드 변환 단계 문구("PDF 3/10페이지 변환 완료")에서 진행률만 꺼낸다. */
export function parseConvertProgress(stage: string | undefined): { current: number; total: number } | null {
  // 백엔드가 보내는 한국어 단계 문구를 읽는 패턴이라 화면 언어와 관계없다.
  const match = stage?.match(/(\d+)\s*\/\s*(\d+)\s*페이지/);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

export function getDocumentConversionView(document: ConversionSource | undefined): DocumentConversionView | null {
  if (!document || !isDocumentConverting(document)) return null;
  return {
    progress: parseConvertProgress(document.processing_stage),
    stalled: document.processing_state === "stalled",
    revision: `${document.processing_stage ?? ""}|${document.updated_at ?? ""}`
  };
}
