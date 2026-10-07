import { useEffect, useState } from "react";
import type { UserPreferences } from "@/entities/user";
import { Switch } from "@/shared/ui/Switch";
import styles from "../SettingsModal.module.css";

type NotificationKey = keyof UserPreferences["notifications"];

interface NotificationsPanelProps {
  notifications: UserPreferences["notifications"];
  updatePreferences: (update: (current: UserPreferences) => UserPreferences) => void;
}

/** 알림 항목 정의 (Figma 963:8257). */
const NOTIFICATION_ROWS: { key: NotificationKey; label: string; description: string }[] = [
  { key: "completed", label: "위키 편입 완료", description: "위키 편입이 끝나면 알림 카드를 표시합니다." },
  { key: "failed", label: "위키 편입 실패", description: "위키 편입에 실패하면 알림 카드를 표시합니다." },
  { key: "lint", label: "위키 다듬기", description: "위키 다듬기(lint) 작업이 끝나면 알립니다." },
  { key: "restore", label: "복구(롤백)", description: "AI 작업 되돌리기가 끝나면 알립니다." },
  { key: "suggest", label: "작업 제안", description: "위키 편입이나 Lint가 필요한 문서가 있으면 실행을 제안합니다." },
  { key: "query", label: "질의 완료", description: "채팅 질의의 답변 도착•실패를 알립니다." },
  { key: "browser", label: "브라우저 알림", description: "탭이 백그라운드일 때 브라우저 알림으로도 보냅니다." }
];

const BROWSER_UNSUPPORTED_MESSAGE = "이 브라우저는 알림을 지원하지 않습니다.";
const BROWSER_DENIED_MESSAGE = "브라우저 알림 권한이 차단되어 있습니다. 주소창의 사이트 설정에서 허용해 주세요.";

type BrowserPermission = NotificationPermission | "unsupported";

function readBrowserPermission(): BrowserPermission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function browserPermissionMessage(permission: BrowserPermission) {
  if (permission === "unsupported") return BROWSER_UNSUPPORTED_MESSAGE;
  if (permission === "denied") return BROWSER_DENIED_MESSAGE;
  return null;
}

/** 알림 설정 패널 (Figma 963:8257). */
export function NotificationsPanel({ notifications, updatePreferences }: NotificationsPanelProps) {
  // 마운트 전(SSR)에는 권한을 모르므로 null. 설정이 켜져 있어도 권한이 granted가 아니면 꺼짐으로 표시한다.
  const [browserPermission, setBrowserPermission] = useState<BrowserPermission | null>(null);
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);

  useEffect(() => {
    const permission = readBrowserPermission();
    setBrowserPermission(permission);
    // 켜 두었는데 권한이 회수됐거나 미지원이면 꺼짐으로 보이는 이유를 알려 준다.
    if (notifications.browser) setBrowserMessage(browserPermissionMessage(permission));
    // 마운트 시점의 권한만 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkedValues = {
    ...notifications,
    browser: notifications.browser && browserPermission === "granted"
  };

  async function toggleNotification(key: NotificationKey) {
    const nextValue = !checkedValues[key];
    // 브라우저 알림은 켤 때 권한 승인이 선행돼야 한다.
    if (key === "browser") {
      setBrowserMessage(null);
      if (nextValue) {
        const current = readBrowserPermission();
        const permission = current === "default" ? await Notification.requestPermission() : current;
        setBrowserPermission(permission);
        if (permission !== "granted") {
          // 권한 요청 창을 닫아 default로 남은 경우도 차단 안내를 보여 준다.
          setBrowserMessage(browserPermissionMessage(permission) ?? BROWSER_DENIED_MESSAGE);
          return;
        }
      }
    }
    updatePreferences((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: nextValue }
    }));
  }

  return (
    <div className={styles.detail}>
      <div className={styles.title}>
        <div className={styles["title-row"]}>
          <h2>알림</h2>
        </div>
        <p>워크스페이스의 알림 권한을 관리합니다.</p>
        {/* Discord와 동일하게 알림 출력 설정은 기기(브라우저)별로 저장된다. 계정 동기화는 서버 저장 API가 필요하다. */}
        <p className={styles["title-note"]}>알림 설정은 이 기기에만 저장됩니다.</p>
      </div>

      <div className={styles.section}>
        <div className={styles["section-header"]}>
          <span>알림 설정</span>
          <span className={styles["section-line"]} />
        </div>
        {NOTIFICATION_ROWS.map(({ key, label, description }) => (
          <div key={key} className={styles.row}>
            <div className={styles["row-title"]}>
              <strong>{label}</strong>
              <small>{description}</small>
              {key === "browser" && browserMessage && (
                <small className={styles["row-error"]} role="alert">{browserMessage}</small>
              )}
            </div>
            <Switch checked={checkedValues[key]} label={label} onClick={() => void toggleNotification(key)} />
          </div>
        ))}
      </div>
    </div>
  );
}
