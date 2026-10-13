export type WorkspaceResponse = {
  id: string;
  name: string;
  icon_emoji: string | null;
  icon_url: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceListResponse = {
  workspaces: WorkspaceResponse[];
  /** 내가 OWNER인 무료 워크스페이스 수. 서버가 아직 주지 않으면 없다. */
  free_workspace_count?: number;
  /** 무료 워크스페이스 소유 한도. null이면 한도가 없다. */
  free_workspace_limit?: number | null;
};
