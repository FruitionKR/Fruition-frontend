export type TreeItem = {
  id: string;
  label: string;
  currentVersion?: number;
  type?: "folder" | "file" | "wiki";
  wikiKind?: "source" | "concept";
  generated?: boolean;
  customLabel?: boolean;
  status?: "uploading" | DocumentStatus;
  processingState?: DocumentProcessingState;
  processingStage?: string;
  errorMessage?: string;
  documentId?: string;
  mimeType?: string;
  byteSize?: number;
  sourceUri?: string;
  uploadedAt?: string;
  updatedAt?: string;
  /** 서버 can_edit. false면 이름 변경·이동을 막는다. 없으면 편집 가능으로 본다. */
  canEdit?: boolean;
  /** 서버 can_delete. false면 삭제 메뉴를 비활성화한다. */
  canDelete?: boolean;
  /** 서버 can_convert. false면 Markdown 변환 메뉴를 비활성화한다. 없으면 지금처럼 요청한다. */
  canConvert?: boolean;
  /** 문서·폴더에 직접 건 권한(edit·view). null·없음은 상위 폴더·기본값을 따른다. */
  permission?: "edit" | "view" | null;
  graphNodeId?: string;
  active?: boolean;
  children?: TreeItem[];
};

export type Project = {
  id: string;
  /** null은 서버 루트(문서·폴더를 한 트리로 보여주는 유일한 프로젝트)다. */
  folderId?: string | null;
  currentVersion?: number;
  title: string;
  items: TreeItem[];
};

export type DropPosition = "before" | "inside" | "after";

export type DropTarget = {
  projectId: string;
  targetId: string | null;
  position: DropPosition;
};

export type ContextMenuState = {
  projectId: string;
  itemId: string | null;
  x: number;
  y: number;
};

export type EditingState = {
  projectId: string;
  itemId: string | null;
  label: string;
};

export type FileDropTarget = {
  projectId: string;
  folderId: string | null;
};

export type UploadPickerTarget = {
  projectId: string;
  folderId: string | null;
};

export type DocumentStatus = "uploaded" | "processing" | "completed" | "failed";

// 파이프라인 처리 진행 상태(백엔드 processing_state). status보다 세분화된 진행 신호.
export type DocumentProcessingState = "starting" | "running" | "stalled" | "completed" | "failed";

export type NoteSaveStatus = "saved" | "dirty" | "saving" | "error" | "lock-lost" | "session-expired";
