import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../src/features/user-settings/${path}`, import.meta.url), "utf8");
const hookSource = read("model/useMfaRequirement.ts");
const modals = {
  PasswordChangeModal: read("ui/modals/PasswordChangeModal.tsx"),
  EmailChangeModal: read("ui/modals/EmailChangeModal.tsx"),
  AccountDeleteModal: read("ui/modals/AccountDeleteModal.tsx")
};

test("서버가 INVALID_MFA_CODE로 거절하면 MFA 상태와 관계없이 코드 칸을 보이고 MFA 상태를 다시 읽는다", () => {
  assert.match(hookSource, /isMfaEnabled: isRequiredByServer \|\| mfaStatus\?\.enabled === true/);
  assert.match(hookSource, /function requireMfa\(\) \{\s*setIsRequiredByServer\(true\);\s*void queryClient\.invalidateQueries\(\{ queryKey: MFA_QUERY_KEY \}\);/);
});

for (const [name, source] of Object.entries(modals)) {
  test(`${name}는 MFA 코드 칸 표시를 useMfaRequirement로 정하고, 인증 코드가 틀리면 requireMfa()를 부른다`, () => {
    assert.match(source, /const \{ isMfaEnabled, requireMfa \} = useMfaRequirement\(\);/);
    assert.doesNotMatch(source, /mfaStatus\?\.enabled/, "조회 결과만으로 칸을 정하지 않는다");
    assert.match(source, /isMfaEnabled && \(/);
  });
}

test("각 모달은 INVALID_MFA_CODE 실패 경로에서 requireMfa()를 부른다", () => {
  const onMfaRecovery = /if \(failure\.recovery === "mfa"\) \{\s*setMfaCode\(""\);\s*requireMfa\(\);/;
  assert.match(modals.PasswordChangeModal, onMfaRecovery);
  assert.match(modals.EmailChangeModal, onMfaRecovery);
  assert.match(modals.AccountDeleteModal, /code === "INVALID_MFA_CODE"\) \{\s*setMfaCode\(""\);\s*requireMfa\(\);/);
});
