/** 스킬 실행용 새 문서 이름 뒤에 붙이는 만든 시각("10.19 14:30"). 같은 스킬을 여러 번 실행해도 이름이 겹치지 않게 한다. */
export function formatSkillDocumentStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}.${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
