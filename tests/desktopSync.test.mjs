import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { toLocalContent, toServerContent, isSameContent } = await import("../src/features/desktop-sync/lib/syncContent.ts");
const { normalizeSyncName, isSameSyncName, toServerFilename, isSyncablePath } = await import("../src/features/desktop-sync/lib/syncNames.ts");
const { classifySyncError } = await import("../src/features/desktop-sync/lib/syncErrors.ts");
const { ApiError, SessionExpiredError } = await import("../src/shared/lib/errors.ts");

test("서버 본문 첫 줄의 마커를 떼어 로컬 본문과 따로 돌려준다", () => {
  assert.deepEqual(toLocalContent("<!-- fruition-note: doc_1 -->\n# 제목\n"), {
    marker: "<!-- fruition-note: doc_1 -->",
    body: "# 제목\n"
  });
  assert.deepEqual(toLocalContent("<!-- fruition-workspace: ws_1 -->\r\n본문\n"), {
    marker: "<!-- fruition-workspace: ws_1 -->",
    body: "본문\n"
  });
});

test("마커가 없는 본문은 그대로 로컬 본문이 된다", () => {
  assert.deepEqual(toLocalContent("# 제목\n"), { marker: null, body: "# 제목\n" });
});

test("보관한 마커를 다시 붙여 서버로 보낼 본문을 만든다", () => {
  assert.equal(toServerContent("# 제목\n", "<!-- fruition-note: doc_1 -->"), "<!-- fruition-note: doc_1 -->\n# 제목\n");
  assert.equal(toServerContent("# 제목\n", null), "# 제목\n");
});

test("마커를 뗐다가 다시 붙이면 서버 본문과 같아진다", () => {
  const server = "<!-- fruition-note: doc_1 -->\n# 제목\n\n본문\n";
  const { marker, body } = toLocalContent(server);
  assert.equal(toServerContent(body, marker), server);
});

test("마커·page 주석·줄바꿈 차이만 있으면 같은 본문으로 본다", () => {
  const server = "<!-- fruition-note: doc_1 -->\n<!-- page 1 -->\n\n# 제목\r\n본문";
  assert.equal(isSameContent("# 제목\n본문\n", server), true);
});

test("내용이 다르면 다른 본문으로 본다", () => {
  assert.equal(isSameContent("# 제목\n수정한 본문\n", "<!-- fruition-note: doc_1 -->\n# 제목\n본문\n"), false);
});

test("파일명은 앞뒤 공백을 지우고 NFC로 맞춘다", () => {
  const nfd = "한글.md".normalize("NFD");
  assert.equal(normalizeSyncName(`  ${nfd} `), "한글.md".normalize("NFC"));
});

test("파일명 비교는 NFC와 대소문자를 무시한다", () => {
  assert.equal(isSameSyncName("회의록.MD".normalize("NFD"), "회의록.md"), true);
  assert.equal(isSameSyncName("회의록.md", "회의록 (2).md"), false);
});

test("로컬 .txt는 서버에서 .md 이름이 된다", () => {
  assert.equal(toServerFilename("메모.txt"), "메모.md");
  assert.equal(toServerFilename("메모.TXT"), "메모.md");
  assert.equal(toServerFilename("논문.pdf"), "논문.pdf");
  assert.equal(toServerFilename("노트.md".normalize("NFD")), "노트.md".normalize("NFC"));
});

test("업로드할 수 있는 확장자만 동기화 대상이다", () => {
  assert.equal(isSyncablePath("자료/논문.pdf"), true);
  assert.equal(isSyncablePath("자료/메모.md"), true);
  assert.equal(isSyncablePath("자료/메모.txt"), true);
  assert.equal(isSyncablePath("자료/보고서.docx"), false);
  assert.equal(isSyncablePath("자료/메모.markdown"), false);
});

test("숨김 파일과 숨김 폴더 안의 파일은 동기화하지 않는다", () => {
  assert.equal(isSyncablePath(".DS_Store"), false);
  assert.equal(isSyncablePath(".fruition/wiki/source/페이지.md"), false);
  assert.equal(isSyncablePath("자료/.assets/image.md"), false);
});

test("409는 서버 code로 버전 충돌과 변환 중을 구분한다", () => {
  assert.equal(classifySyncError(new ApiError("충돌", 409, "DOCUMENT_VERSION_CONFLICT")), "version-conflict");
  assert.equal(classifySyncError(new ApiError("처리 중", 409, "DOCUMENT_ALREADY_PROCESSING")), "processing");
  assert.equal(classifySyncError(new ApiError("이미 있음", 409, "DOCUMENT_ALREADY_EXISTS")), "rejected");
});

test("권한·없음·크기 초과는 다시 보내지 않는 오류로 분류한다", () => {
  assert.equal(classifySyncError(new ApiError("권한 없음", 403, "DOCUMENT_WRITE_FORBIDDEN")), "forbidden");
  assert.equal(classifySyncError(new ApiError("없음", 404)), "not-found");
  assert.equal(classifySyncError(new ApiError("너무 큼", 413, "MARKDOWN_CONTENT_TOO_LARGE")), "too-large");
  assert.equal(classifySyncError(new ApiError("잘못된 요청", 400)), "rejected");
});

test("세션 만료는 다시 로그인할 때까지 대기열에 남긴다", () => {
  assert.equal(classifySyncError(new SessionExpiredError("만료")), "session-expired");
});

test("서버 오류와 네트워크 오류는 다시 보낸다", () => {
  assert.equal(classifySyncError(new ApiError("서버 오류", 503)), "retry");
  assert.equal(classifySyncError(new TypeError("Failed to fetch")), "retry");
});

test("마커만 있는 본문과 CR 줄바꿈, 마커 바로 뒤 page 주석도 같은 본문으로 비교한다", () => {
  assert.deepEqual(toLocalContent("<!-- fruition-note: doc_1 -->"), { marker: "<!-- fruition-note: doc_1 -->", body: "" });
  assert.equal(isSameContent("", "<!-- fruition-note: doc_1 -->\n"), true);
  assert.equal(isSameContent("# 제목\r본문", "# 제목\n본문\n"), true);
  assert.equal(isSameContent("본문\n", "<!-- fruition-note: doc_1 -->\n<!-- page 3 -->\n본문\n"), true);
});

test("대문자 확장자와 이름 끝 공백도 서버와 같은 기준으로 동기화 대상이 된다", () => {
  assert.equal(isSyncablePath("자료/논문.PDF"), true);
  assert.equal(isSyncablePath("자료/하위/메모.TXT"), true);
  assert.equal(isSyncablePath("자료/메모.md "), true);
  assert.equal(toServerFilename(" 메모.txt "), "메모.md");
});

test("끝에 슬래시가 있는 경로는 폴더라 동기화 대상이 아니다", () => {
  assert.equal(isSyncablePath("자료/b.md/"), false);
  assert.equal(isSyncablePath(""), false);
});

test("429와 408은 일시적인 오류라 다시 보낸다", () => {
  assert.equal(classifySyncError(new ApiError("너무 많음", 429)), "retry");
  assert.equal(classifySyncError(new ApiError("시간 초과", 408)), "retry");
  assert.equal(classifySyncError(new ApiError("서버 오류", 500)), "retry");
  assert.equal(classifySyncError(new ApiError("인증", 401)), "rejected");
});
