import assert from "node:assert/strict";
import test from "node:test";

const {
  AccountDeletionBlockedError,
  accountDeletionErrorMessage,
  buildAccountDeletionBody,
  isReauthenticationRequired,
  parseSoleOwnerWorkspaces
} = await import("../src/entities/user/model/accountDeletion.ts");
const { clearFruitionStorage } = await import("../src/shared/lib/authSessionStorage.ts");
const { hasSettingsResume, saveSettingsResume, takeSettingsResume } = await import("../src/features/user-settings/lib/settingsResume.ts");

const withCode = (code, message = "server", status = 401) => Object.assign(new Error(message), { code, status });

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key)
  };
}

test("탈퇴 본문은 비밀번호·MFA 코드가 있을 때만 넣고, 비어 있으면 필드 자체를 생략한다", () => {
  assert.deepEqual(buildAccountDeletionBody({ password: "", mfaCode: "" }), {});
  assert.deepEqual(buildAccountDeletionBody({ password: "pw", mfaCode: "" }), { password: "pw" });
  assert.deepEqual(buildAccountDeletionBody({ password: "", mfaCode: " 123456 " }), { mfa_code: "123456" });
  assert.deepEqual(buildAccountDeletionBody({ password: "pw", mfaCode: "abcd-1234" }), { password: "pw", mfa_code: "abcd-1234" });
});

test("탈퇴 실패는 서버 error.code와 429로 안내하고, 모르는 code는 서버 메시지를 쓴다", () => {
  assert.match(accountDeletionErrorMessage(withCode("INVALID_CREDENTIALS"), "fb"), /비밀번호가 올바르지/);
  assert.match(accountDeletionErrorMessage(withCode("INVALID_MFA_CODE"), "fb"), /인증 코드가 올바르지/);
  assert.match(accountDeletionErrorMessage(withCode("REAUTHENTICATION_REQUIRED"), "fb"), /다시 로그인한 뒤 10분 안에/);
  assert.match(accountDeletionErrorMessage(withCode("SOLE_OWNER_OF_SHARED_WORKSPACE", "s", 409), "fb"), /OWNER를 먼저 넘겨/);
  assert.match(accountDeletionErrorMessage(withCode(undefined, "too many", 429), "fb"), /시도가 너무 많습니다/);
  assert.equal(accountDeletionErrorMessage(withCode("UNKNOWN", "서버 문구"), "fb"), "서버 문구");
  assert.equal(accountDeletionErrorMessage("not an error", "fb"), "fb");
  assert.equal(isReauthenticationRequired(withCode("REAUTHENTICATION_REQUIRED")), true);
  assert.equal(isReauthenticationRequired(withCode("INVALID_CREDENTIALS")), false);
});

test("409 본문의 workspaces는 id가 있는 항목만 남기고, 이름이 없으면 id로 대신한다", () => {
  assert.deepEqual(parseSoleOwnerWorkspaces({ workspaces: [{ id: "ws_1", name: "디자인팀" }, { id: "ws_2" }, { name: "없음" }, null] }), [
    { id: "ws_1", name: "디자인팀" },
    { id: "ws_2", name: "ws_2" }
  ]);
  assert.deepEqual(parseSoleOwnerWorkspaces({ workspaces: "nope" }), []);
  assert.deepEqual(parseSoleOwnerWorkspaces(null), []);

  const blocked = new AccountDeletionBlockedError("막힘", [{ id: "ws_1", name: "디자인팀" }]);
  assert.equal(blocked.code, "SOLE_OWNER_OF_SHARED_WORKSPACE");
  assert.equal(blocked.status, 409);
  assert.match(accountDeletionErrorMessage(blocked, "fb"), /OWNER를 먼저 넘겨/);
});

test("탈퇴 뒤 fruition.* 키만 두 저장소에서 모두 지우고 다른 키는 남긴다", () => {
  const local = memoryStorage({ "fruition.workspace_id": "ws", "fruition.preferences.v1.u1": "{}", "other.key": "keep" });
  const session = memoryStorage({ "fruition.after_login": "/home", "fruition.last-document.ws": "doc", "theme": "dark" });

  clearFruitionStorage([local, session]);

  assert.equal(local.length, 1);
  assert.equal(local.getItem("other.key"), "keep");
  assert.equal(session.length, 1);
  assert.equal(session.getItem("theme"), "dark");
});

test("설정 복귀 위치는 한 번만 읽히고, 모르는 값은 버린다", () => {
  const storage = memoryStorage();
  assert.equal(hasSettingsResume(storage), false);
  saveSettingsResume("account-delete", storage);
  assert.equal(hasSettingsResume(storage), true);
  assert.equal(takeSettingsResume(storage), "account-delete");
  assert.equal(takeSettingsResume(storage), null);

  storage.setItem("fruition.settings_resume", "somewhere-else");
  assert.equal(takeSettingsResume(storage), null);
  assert.equal(hasSettingsResume(storage), false);
});
