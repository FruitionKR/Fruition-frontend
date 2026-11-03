export type WorkspaceResponse = {
  id: string;
  name: string;
  icon_emoji: string | null;
  icon_url: string | null;
  /** 업로드한 문서를 변환 뒤 자동으로 위키에 편입할지. 업로더에게 wiki.ingest가 있을 때만 적용된다(access #32). */
  auto_ingest_on_upload: boolean;
  /** PDF 변환 때 그림을 외부 AI(워크스페이스 AI 모델)로 보내 설명을 붙일지. 기본 꺼짐. 구 서버 응답은 생략된다. */
  describe_pdf_figures?: boolean;
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
