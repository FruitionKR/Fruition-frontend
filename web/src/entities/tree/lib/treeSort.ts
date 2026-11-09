const compareName = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" });
const withoutMd = (label: string) => label.replace(/\.md$/i, "");
// 확장자를 뺀 이름이 정확히 같은 문서와 폴더(Notion 하위 페이지)는 문서를 먼저 둔다. 나머지는 이름순 그대로다.
export const compareTreeItemsByName = (a: { label: string; type?: string }, b: { label: string; type?: string }) => {
  if ((a.type === "folder") !== (b.type === "folder") && withoutMd(a.label) === withoutMd(b.label)) {
    return a.type === "folder" ? 1 : -1;
  }
  return compareName(a.label, b.label);
};

