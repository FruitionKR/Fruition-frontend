import type { Metadata } from "next";
import McpWikiDraftApprovalPage from "@/features/mcp-approval/ui/McpWikiDraftApprovalPage";

export const metadata: Metadata = { referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string; draftId: string }> }) {
  const { workspaceId, draftId } = await params;
  return <McpWikiDraftApprovalPage workspaceId={workspaceId} draftId={draftId} />;
}
