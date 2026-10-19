/** 스킬 종류 라벨. 스킬 만들기의 종류 선택(문서·폴더 정리·템플릿)과 같은 기준으로 capabilities에서 정한다. */
export function skillKindLabel(capabilities: readonly string[]): string {
  if (capabilities.includes("folder-organize")) return "폴더 정리";
  if (capabilities.includes("template")) return "템플릿";
  return "문서";
}
