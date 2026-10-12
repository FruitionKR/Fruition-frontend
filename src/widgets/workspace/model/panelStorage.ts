/** 패널 폭 상태 localStorage 읽기. 읽기 실패(사생활 보호 모드 등)는 null로 보고 기본값을 쓴다. */
export function readStoredPanel(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredPanel(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 못 쓰는 환경에서는 이번 세션 동안만 유지한다.
  }
}
