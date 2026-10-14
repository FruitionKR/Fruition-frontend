"use client";

import dynamic from "next/dynamic";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";

export const DynamicWikiPageEditor = dynamic(
  () => import("./WikiPageEditor").then((module) => module.WikiPageEditor),
  {
    ssr: false,
    loading: () => <DocumentLoading>편집기를 불러오는 중입니다.</DocumentLoading>
  }
);
