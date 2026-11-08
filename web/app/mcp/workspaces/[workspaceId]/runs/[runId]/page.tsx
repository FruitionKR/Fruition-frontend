import type { Metadata } from "next";
import McpApprovalPage from "@/features/mcp-approval/ui/McpApprovalPage";

export const metadata: Metadata = { referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const { workspaceId, runId } = await params;
  return <McpApprovalPage workspaceId={workspaceId} runId={runId} />;
}
