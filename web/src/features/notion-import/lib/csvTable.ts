/**
 * Notion 데이터베이스 CSV를 GFM 표 하나로 바꾼다. 테스트가 그대로 불러 쓰도록 다른 모듈을 import하지 않는다.
 */

/** RFC 4180 CSV 파싱: 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다. BOM은 뗀다. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== "\"") cell += char;
      else if (source[index + 1] === "\"") { cell += "\""; index += 1; }
      else quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 값이 모두 빈 행(`,,`)도 데이터라 남긴다. 파일 끝 줄바꿈 뒤에 생긴 빈 줄(칸 하나짜리 빈 행)만 버린다.
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

/** 표 칸 하나: 줄바꿈은 공백으로 합치고 `|`·`\`는 이스케이프한다. 편집기가 HTML을 그리지 않아 <br>은 쓰지 않는다. */
export function escapeTableCell(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * CSV 본문을 GFM 표 Markdown으로 바꾼다. 행이 없으면 머리글만 있는 표가 된다.
 * decorateCell은 본문 칸(머리글 제외)을 이스케이프한 뒤 바꿀 때 쓴다(행 번호는 본문 기준 0부터).
 */
export function csvToMarkdownTable(
  text: string,
  decorateCell: (row: number, column: number, escaped: string) => string = (_row, _column, escaped) => escaped
): string {
  const rows = parseCsv(text);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((cells) => cells.length));
  const line = (cells: string[], row: number | null) => {
    const padded = Array.from({ length: width }, (_, index) => {
      const escaped = escapeTableCell(cells[index] ?? "");
      return row === null ? escaped : decorateCell(row, index, escaped);
    });
    return `| ${padded.map((cell) => cell || " ").join(" | ")} |`;
  };
  const [header, ...body] = rows;
  return [line(header, null), `|${" --- |".repeat(width)}`, ...body.map((cells, row) => line(cells, row))].join("\n");
}
