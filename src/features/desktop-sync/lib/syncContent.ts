import { composeEditableNoteMarkdown, splitEditableNoteMarkdown, stripPageComments } from "@/entities/document/lib/note";

/** 로컬 파일에 쓸 본문과, 업로드할 때 다시 붙일 서버 첫 줄 마커. */
export type LocalContent = {
  marker: string | null;
  body: string;
};

/** 서버 본문에서 첫 줄 마커를 떼어 로컬 파일 본문과 따로 돌려준다. 마커는 원문 그대로 보관한다. */
export function toLocalContent(serverMarkdown: string): LocalContent {
  const split = splitEditableNoteMarkdown(serverMarkdown);
  return split ? { marker: split.marker, body: split.body } : { marker: null, body: serverMarkdown };
}

/** 로컬 본문에 보관한 마커를 다시 붙여 서버로 보낼 본문을 만든다. */
export function toServerContent(localBody: string, marker: string | null): string {
  return marker ? composeEditableNoteMarkdown(marker, localBody) : localBody;
}

/** 마커·page 주석·줄바꿈 차이를 무시하고 같은 본문인지 비교한다. 웹 에디터가 저장할 때 지우는 부분이라 차이로 보지 않는다. */
export function isSameContent(localBody: string, serverMarkdown: string): boolean {
  return normalizeForCompare(localBody) === normalizeForCompare(toLocalContent(serverMarkdown).body);
}

function normalizeForCompare(markdown: string): string {
  return stripPageComments(markdown.replace(/\r\n?/g, "\n")).replace(/\n+$/, "");
}
