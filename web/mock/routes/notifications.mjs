// document-svc(8080) 앱 안 알림 라우트: 목록·읽음·모두 읽음. 읽음은 사용자별(read_by)로 기록한다.
import { state, error, requireWorkspace, memberRole } from "../state.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** audience=user는 수신자 본인에게, workspace_owners는 조회 시점 OWNER에게 보인다. */
function visibleNotifications(workspace, userId) {
  const isOwner = memberRole(workspace.id, userId) === "OWNER";
  return state.notifications.filter((notification) => notification.workspace_id === workspace.id && (
    notification.audience === "workspace_owners" ? isOwner : notification.recipient_user_id === userId
  ));
}

function toNotification(notification, userId) {
  return { id: notification.id, type: notification.type, payload: notification.payload, read: notification.read_by.has(userId), created_at: notification.created_at };
}

export function registerNotificationRoutes(router) {
  router.get("/api/workspaces/:wid/notifications", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const unreadOnly = ctx.query.get("unread_only") === "true";
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(ctx.query.get("limit")) || DEFAULT_LIMIT));
    const before = ctx.query.get("before");
    const beforeId = ctx.query.get("before_id");
    const notifications = visibleNotifications(workspace, ctx.user.id)
      .map((notification) => toNotification(notification, ctx.user.id))
      .filter((notification) => !unreadOnly || !notification.read)
      // (created_at, id)가 커서보다 앞선 알림만. before_id 없이 before만 오면 시각만 비교한다.
      .filter((notification) => !before || notification.created_at < before || (beforeId && notification.created_at === before && notification.id < beforeId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, limit);
    ctx.json(200, { notifications });
  });

  // 알림을 "모두 읽음"보다 먼저 등록해야 :id 라우트가 read-all을 가로채지 않는다.
  router.post("/api/workspaces/:wid/notifications/read-all", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    visibleNotifications(workspace, ctx.user.id).forEach((notification) => notification.read_by.add(ctx.user.id));
    ctx.json(204, null);
  });

  router.post("/api/workspaces/:wid/notifications/:id/read", (ctx) => {
    const workspace = requireWorkspace(ctx);
    if (!workspace) return;
    const notification = visibleNotifications(workspace, ctx.user.id).find((item) => item.id === ctx.params.id);
    if (!notification) return error(ctx, 404, "알림을 찾을 수 없습니다.", "NOTIFICATION_NOT_FOUND");
    notification.read_by.add(ctx.user.id);
    ctx.json(204, null);
  });
}
