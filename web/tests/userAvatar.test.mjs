import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Node 테스트에서도 앱의 TypeScript 경로 별칭을 같은 소스로 해석한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".ts", context);
    return nextResolve(specifier, context);
  }
});

const { AVATAR_ACCEPT, AVATAR_MAX_BYTES, avatarInitial, avatarUploadErrorMessage, validateAvatarFile } = await import("../src/entities/user/lib/avatarFile.ts");
const { uploadAvatar, deleteAvatar, fetchUserAvatar } = await import("../src/entities/user/api/account.ts");
const { ApiError } = await import("../src/shared/lib/apiErrors.ts");
const { saveAccessToken } = await import("../src/shared/lib/authSessionStorage.ts");
const nextConfig = (await import("../next.config.mjs")).default;

test("선검사: PNG·JPEG·WebP·GIF 1MB 이하만 통과한다", () => {
  assert.equal(validateAvatarFile({ size: 10, type: "image/png" }), null);
  assert.equal(validateAvatarFile({ size: AVATAR_MAX_BYTES, type: "image/webp" }), null);
  assert.match(validateAvatarFile({ size: AVATAR_MAX_BYTES + 1, type: "image/jpeg" }), /1MB 이하/);
  assert.match(validateAvatarFile({ size: 10, type: "image/svg+xml" }), /PNG·JPEG·WebP·GIF/);
  assert.match(validateAvatarFile({ size: 0, type: "image/gif" }), /빈 파일/);
  assert.equal(AVATAR_ACCEPT, "image/png,image/jpeg,image/webp,image/gif");
});

test("서버 거절 400 UNSUPPORTED_USER_AVATAR·413 USER_AVATAR_TOO_LARGE를 안내 문구로 바꾼다", () => {
  assert.match(avatarUploadErrorMessage(new ApiError("서버 문구", 400, "UNSUPPORTED_USER_AVATAR"), "실패"), /PNG·JPEG·WebP·GIF/);
  assert.match(avatarUploadErrorMessage(new ApiError("서버 문구", 413, "USER_AVATAR_TOO_LARGE"), "실패"), /1MB 이하/);
  assert.equal(avatarUploadErrorMessage(new ApiError("다른 오류", 500), "실패"), "다른 오류");
  assert.equal(avatarUploadErrorMessage("문자열", "실패"), "실패");
});

test("avatar_url이 없으면 이름 첫 글자, 이름도 없으면 '사'로 돌아간다", () => {
  assert.equal(avatarInitial("홍길동"), "홍");
  assert.equal(avatarInitial("  user@example.com"), "u");
  assert.equal(avatarInitial(""), "사");
  assert.equal(avatarInitial(null), "사");
});

test("업로드는 multipart PUT, 삭제는 DELETE이며 응답 MeResponse의 avatar_url을 그대로 돌려준다", async (t) => {
  saveAccessToken("avatar-test-access");
  const calls = [];
  const avatarUrl = "/api/users/user_test/avatar?v=abc";
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.method, init.headers.get("Authorization"), init.body instanceof FormData ? init.body.get("file")?.name : null]);
    return Response.json({ id: "user_test", avatar_url: init.method === "PUT" ? avatarUrl : null });
  });
  const uploaded = await uploadAvatar(new File([new Uint8Array([0x89, 0x50])], "me.png", { type: "image/png" }));
  assert.equal(uploaded.avatar_url, avatarUrl);
  const deleted = await deleteAvatar();
  assert.equal(deleted.avatar_url, null);
  assert.deepEqual(calls, [
    ["/api/auth/me/avatar", "PUT", "Bearer avatar-test-access", "me.png"],
    ["/api/auth/me/avatar", "DELETE", "Bearer avatar-test-access", null]
  ]);
});

test("업로드 거절은 status·code를 보존해 화면이 안내 문구로 바꿀 수 있다", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "USER_AVATAR_TOO_LARGE", message: "too large" } }, { status: 413 }));
  await assert.rejects(uploadAvatar(new File(["x"], "big.png", { type: "image/png" })), (error) => {
    assert.equal(error.status, 413);
    assert.equal(error.code, "USER_AVATAR_TOO_LARGE");
    assert.match(avatarUploadErrorMessage(error, "실패"), /1MB 이하/);
    return true;
  });
});

test("사진 조회는 avatar_url(?v= 포함)을 그대로 Bearer 요청해 Blob으로 받는다", async (t) => {
  saveAccessToken("avatar-test-access");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push([path, init.headers.get("Authorization")]);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
  });
  const blob = await fetchUserAvatar("/api/users/user_test/avatar?v=abc");
  assert.equal(blob.size, 3);
  assert.deepEqual(calls, [["/api/users/user_test/avatar?v=abc", "Bearer avatar-test-access"]]);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "USER_AVATAR_NOT_FOUND", message: "없음" } }, { status: 404 }));
  await assert.rejects(fetchUserAvatar("/api/users/user_test/avatar"), /없음/);
});

test("프로필 사진 조회 경로는 document-svc가 아니라 access-svc로 전달한다", async () => {
  const rewrites = await nextConfig.rewrites();
  const accessUrl = process.env.ACCESS_URL || "http://localhost:8081";
  const avatar = rewrites.findIndex((route) => route.source === "/api/users/:uid/avatar");
  const catchAll = rewrites.findIndex((route) => route.source === "/api/:path*");
  assert.equal(rewrites[avatar]?.destination, `${accessUrl}/api/users/:uid/avatar`);
  assert.ok(avatar >= 0 && avatar < catchAll);
});
