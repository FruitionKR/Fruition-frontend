// 소셜 재로그인처럼 오리진을 벗어났다 돌아온 뒤, 설정 모달을 떠났던 자리로 다시 여는 sessionStorage 항목.

const SETTINGS_RESUME_STORAGE_KEY = "fruition.settings_resume";

/** 돌아와서 열 설정 위치. account-delete는 계정 설정의 탈퇴 확인 단계를 다시 연다. */
export type SettingsResume = "members" | "account-delete";

const RESUME_VALUES: readonly SettingsResume[] = ["members", "account-delete"];

type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): ResumeStorage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function saveSettingsResume(resume: SettingsResume, storage = defaultStorage()) {
  storage?.setItem(SETTINGS_RESUME_STORAGE_KEY, resume);
}

export function hasSettingsResume(storage = defaultStorage()): boolean {
  return Boolean(storage?.getItem(SETTINGS_RESUME_STORAGE_KEY));
}

/** 남겨 둔 위치를 한 번만 읽는다. 모르는 값은 버린다. */
export function takeSettingsResume(storage = defaultStorage()): SettingsResume | null {
  const raw = storage?.getItem(SETTINGS_RESUME_STORAGE_KEY);
  if (!raw) return null;
  storage?.removeItem(SETTINGS_RESUME_STORAGE_KEY);
  return RESUME_VALUES.includes(raw as SettingsResume) ? (raw as SettingsResume) : null;
}
