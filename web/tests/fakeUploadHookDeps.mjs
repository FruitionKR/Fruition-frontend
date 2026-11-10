// useDocumentUpload·useDocumentProcessingNotifications 훅 테스트용 가짜 의존성. 여러 별칭을 이 한 모듈로 풀어
// 테스트가 controls로 업로드·트리 응답을 정한다. 업로드 대기열은 실제 실행기(동시 2개)를 쓴다.
import { createConcurrencyLimiter } from "../src/shared/lib/concurrencyLimit.ts";

export const controls = {
  /** (file, folderId) => Promise<응답>. 테스트마다 바꾼다. */
  upload: async (file) => ({ id: `doc-${file.name}`, filename: file.name, status: "completed" }),
  /** 다시 올리기 전 서버 트리 응답 */
  tree: async () => ({ items: [] }),
  sent: [],
  treeFetches: 0,
  ingestRequests: [],
  /** 꺼 둔 알림 설정 키 */
  disabledNotices: new Set(),
  /** useSelectedWorkspace 응답 */
  workspace: null,
  canIngest: false
};

let limit = createConcurrencyLimiter(2);
export function resetUploadQueue() {
  limit = createConcurrencyLimiter(2);
  controls.sent = [];
  controls.treeFetches = 0;
  controls.ingestRequests = [];
  controls.disabledNotices = new Set();
  controls.workspace = null;
  controls.canIngest = false;
}

// @/entities/document/api/document
export function uploadDocumentFile(file, folderId = null, { onStart, beforeSend } = {}) {
  let blocked = null;
  return limit(() => {
    if (blocked) throw blocked.error;
    controls.sent.push(file.name);
    return controls.upload(file, folderId);
  }, () => {
    try {
      beforeSend?.();
    } catch (error) {
      blocked = { error };
      return;
    }
    onStart?.();
  });
}
export async function reflectDocumentToWiki(id) {
  controls.ingestRequests.push(id);
}

// @/entities/tree/api/documentTree
export function fetchDocumentTree() {
  controls.treeFetches += 1;
  return controls.tree();
}

// @/entities/workspace
export const describeLimitError = () => null;
export const invalidateStorageUsage = () => {};
export const useSelectedWorkspace = () => controls.workspace;

// @tanstack/react-query
export const useQueryClient = () => ({});

// @/shared/lib/analytics/client
export const captureAnalytics = () => {};

// @/features/wiki-ingest/model/useWikiActionPermissions
export const useWikiActionPermissions = () => ({ canIngest: controls.canIngest, canLint: false });

// @/features/note-editing/api/note
export async function saveNoteDraft(documentId, markdown, baseVersion) {
  return { content_version: baseVersion + 1, attachments: [] };
}

// @/entities/user
const allOn = new Proxy({}, { get: (_, key) => key !== "browser" && !controls.disabledNotices.has(key) });
export const useUserPreferences = () => ({ preferences: { notifications: allOn, notificationControls: { enabled: true, groups: {} } }, reduceMotion: true });

// @/shared/hooks/usePageVisible
export const usePageVisible = () => true;
