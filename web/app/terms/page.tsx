import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocumentPage } from "@/views/legal/ui/LegalDocumentPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("termsTitle") };
}

export default function TermsPage({ searchParams }: { searchParams: Promise<{ version?: string | string[] }> }) {
  return <LegalDocumentPage slug="terms" searchParams={searchParams} />;
}
