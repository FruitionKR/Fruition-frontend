// Notion "Markdown & CSV" 내보내기 모양의 작은 zip을 테스트 안에서 만든다(실제 Notion 데이터는 쓰지 않는다).
import { registerHooks } from "node:module";
import { strToU8, zipSync } from "fflate";

/** src의 `@/` 별칭과 확장자 없는 상대 import를 .ts로 푼다. */
export function registerSrcHooks() {
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes("/src/")) return next(specifier + ".ts", context);
    return next(specifier, context);
  } });
}

export const ID = {
  home: "a".repeat(32),
  child: "b".repeat(32),
  db: "c".repeat(32),
  row: "e".repeat(32),
  memo: "f".repeat(32),
  memo2: "1".repeat(32)
};

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
/** `%PDF-`로 시작하는 작은 PDF 흉내 */
export const PDF = "%PDF-1.4\n%test\n";

const enc = (path) => path.split("/").map(encodeURIComponent).join("/");

/** 파일 경로 → 내용(string|Uint8Array) 객체를 zip 바이트로 만든다. */
export function zipFiles(files, options = {}) {
  const bytes = (content) => typeof content === "string" ? strToU8(content) : content;
  // [내용, { os, attrs }] 꼴이면 zip 항목 속성(심볼릭 링크 등)을 함께 넣는다.
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, Array.isArray(content) ? [bytes(content[0]), content[1]] : bytes(content)]));
  return zipSync(entries, options);
}

/**
 * 하위 페이지·이미지·데이터베이스·행 페이지(속성·PDF 첨부)·PPTX·중복 이름·NFD 한글 이름을 담은 내보내기.
 * folderIds=false면 실제 최근 Notion 내보내기처럼 폴더 이름에는 id가 없다(`홈 <id>.md` + `홈/`).
 */
export function notionExportFiles({ folderIds = true } = {}) {
  const home = `홈 ${ID.home}`;
  const homeDir = folderIds ? home : "홈";
  const db = `${homeDir}/할일 ${ID.db}`;
  const dbDir = folderIds ? db : `${homeDir}/할일`;
  const row = `행 ${ID.row}`;
  const rowDir = folderIds ? row : "행";
  return {
    [`Export-1234/${home}.md`]: [
      "# 홈",
      "",
      `[하위](${enc(`${homeDir}/하위 ${ID.child}.md`)}) 와 [표](${enc(`${db}.csv`)})`,
      `![사진](${enc(`${homeDir}/photo.png`)})`,
      `![가짜](${enc(`${homeDir}/fake.png`)})`,
      "[외부](https://example.com/a)",
      `[절대](https://www.notion.so/team/Sub-${ID.child}?pvs=4) [밖 노션](https://www.notion.so/Else-${"9".repeat(32)})`,
      `[깨짐](${enc(`없음 ${"d".repeat(32)}.md`)})`,
      "<aside>💡 알림 <script>alert(1)</script></aside>",
      "```",
      "<b>코드 안 HTML</b>",
      "```"
    ].join("\n"),
    [`Export-1234/${homeDir}/하위 ${ID.child}.md`]: `# 하위\n\n[위로](${enc(`../${home}.md`)}#heading)\n`,
    [`Export-1234/${homeDir}/photo.png`]: PNG,
    [`Export-1234/${homeDir}/fake.png`]: "not an image",
    [`Export-1234/${homeDir}/slides.pptx`]: "PK",
    [`Export-1234/${db}.csv`]: "이름,상태\n일부,완료\n",
    [`Export-1234/${db}_all.csv`]: "\ufeff이름,상태,메모\n첫 일,완료,\"쉼표, 있음\"\n행,진행,\n",
    [`Export-1234/${dbDir}/${row}.md`]: `# 행\n\n상태: 완료\n담당: 홈 (https://www.notion.so/Home-${ID.home}?pvs=21)\n\n[첨부](${enc(`${rowDir}/첨부.pdf`)})\n`,
    [`Export-1234/${dbDir}/${rowDir}/첨부.pdf`]: PDF,
    // macOS에서 만든 zip은 한글 이름이 NFD로 들어올 수 있다.
    [`Export-1234/${`메모 ${ID.memo}.md`.normalize("NFD")}`]: "# 메모\n",
    [`Export-1234/메모 ${ID.memo2}.md`]: "# 메모 둘\n",
    "Export-1234/첨부.pdf": "%PDF"
  };
}
