"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { DocumentLoading } from "@/shared/ui/DocumentLoading";

export const DynamicNoteEditor = dynamic(
  () => import("./NoteEditor").then((module) => module.NoteEditor),
  {
    ssr: false,
    loading: () => <EditorLoading />
  }
);

function EditorLoading() {
  const t = useTranslations("documents.editor.loading");
  return <DocumentLoading inline>{t("module")}</DocumentLoading>;
}
