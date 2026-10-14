"use client";

import dynamic from "next/dynamic";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";

export const DynamicNoteEditor = dynamic(
  () => import("./NoteEditor").then((module) => module.NoteEditor),
  {
    ssr: false,
    loading: () => <DocumentLoading>노트 편집기를 불러오는 중입니다.</DocumentLoading>
  }
);
