import type { DocumentItemResponse } from "@/entities/document/model/document";
import { isDocumentConverting } from "./documentKind";

/** 변환 중인 Markdown(변환 결과 placeholder)을 열었을 때 보여 줄 상태. */
export type DocumentConversionView = {
  /** "3/10페이지"처럼 processing_stage에서 읽은 진행률. 알 수 없으면 null. */
  progress: string | null;
  /** heartbeat가 끊겨 변환이 멈춘 상태(processing_state === "stalled") */
  stalled: boolean;
  /** 묶음이 추가될 때마다 바뀌는 값. 바뀌면 열린 본문을 다시 불러온다. */
  revision: string;
};

type ConversionSource = Pick<DocumentItemResponse, "status" | "pipeline_run_id" | "processing_state" | "processing_stage" | "updated_at">;

/** 백엔드 변환 단계 문구("PDF 3/10페이지 변환 완료")에서 진행률만 꺼낸다. */
export function parseConvertProgress(stage: string | undefined): string | null {
  const match = stage?.match(/(\d+)\s*\/\s*(\d+)\s*페이지/);
  return match ? `${match[1]}/${match[2]}페이지` : null;
}

export function getDocumentConversionView(document: ConversionSource | undefined): DocumentConversionView | null {
  if (!document || !isDocumentConverting(document)) return null;
  return {
    progress: parseConvertProgress(document.processing_stage),
    stalled: document.processing_state === "stalled",
    revision: `${document.processing_stage ?? ""}|${document.updated_at ?? ""}`
  };
}

/** 변환 중인 Markdown 위에 띄울 안내 문구. 원본 PDF가 아니라 변환 결과 MD를 보고 있다는 문맥으로 쓴다. */
export function getConversionNotice(view: DocumentConversionView): string {
  if (view.stalled) {
    return "변환이 멈췄어요. 원본 PDF를 우클릭해 \"Markdown으로 변환\"으로 다시 시도해 주세요.";
  }
  const progress = view.progress ? ` (${view.progress})` : "";
  return `원본 PDF에서 내용을 가져오는 중이에요${progress}. 변환이 끝나면 편집할 수 있어요.`;
}
