import type { Metadata } from "next";
import { LegalDocumentPage } from "@/views/legal/ui/LegalDocumentPage";

export const metadata: Metadata = { title: "이용약관 · Fruition" };

export default function TermsPage({ searchParams }: { searchParams: Promise<{ version?: string | string[] }> }) {
  return <LegalDocumentPage slug="terms" searchParams={searchParams} />;
}
