import type { Metadata } from "next";
import { LegalDocumentPage } from "@/views/legal/ui/LegalDocumentPage";

export const metadata: Metadata = { title: "개인정보 처리방침 · Fruition" };

export default function PrivacyPage({ searchParams }: { searchParams: Promise<{ version?: string | string[] }> }) {
  return <LegalDocumentPage slug="privacy" searchParams={searchParams} />;
}
