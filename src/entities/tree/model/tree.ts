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
  graphNodeId?: string;
  active?: boolean;
  children?: TreeItem[];
};

export type Project = {
  id: string;
  /** null은 서버 루트 문서를 보여주는 가상 그룹이다. */
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

export type NoteSaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
