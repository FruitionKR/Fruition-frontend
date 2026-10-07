"use client";

import dynamic from "next/dynamic";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";

// pdf.js와 뷰어 CSS는 PDF를 열 때만 불러와 초기 번들에 넣지 않는다.
export const DynamicPdfViewer = dynamic(
  () => import("./PdfViewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => <DocumentLoading>문서를 불러오는 중입니다.</DocumentLoading>
  }
);
