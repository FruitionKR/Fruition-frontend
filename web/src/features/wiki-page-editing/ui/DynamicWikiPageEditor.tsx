"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";

function EditorLoading() {
  const t = useTranslations("wiki.pageEditing");
  return <DocumentLoading>{t("editorLoading")}</DocumentLoading>;
}

export const DynamicWikiPageEditor = dynamic(
  () => import("./WikiPageEditor").then((module) => module.WikiPageEditor),
  {
    ssr: false,
    loading: () => <EditorLoading />
  }
);
