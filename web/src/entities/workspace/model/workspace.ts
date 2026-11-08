export type WorkspaceResponse = {
  id: string;
  name: string;
  icon_emoji: string | null;
  icon_url: string | null;
  /**
   * 업로드한 문서를 변환 뒤 자동으로 위키에 편입할지. 업로더에게 wiki.ingest가 있을 때만 적용된다(access #32).
   * 새 서버에서는 auto_ingest_pdf_on_convert와 같은 값이고, 이 필드만 바꾸면 두 설정이 함께 바뀐다.
   */
  auto_ingest_on_upload: boolean;
  /** Markdown·txt 업로드 직후 서버가 자동 편입할지. 기본 켜짐. 구 서버 응답은 생략된다. */
  auto_ingest_markdown_on_upload?: boolean;
  /** PDF 변환이 끝나면 서버가 변환본을 자동 편입할지. 구 서버 응답은 생략된다. */
  auto_ingest_pdf_on_convert?: boolean;
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
