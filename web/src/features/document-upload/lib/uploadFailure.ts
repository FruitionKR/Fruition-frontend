/** 업로드 실패 알림 문구: 어떤 파일이 왜 실패했는지 함께 보인다. */
export function uploadFailureMessage(filename: string, reason: string): string {
  return `"${filename}" 파일을 올리지 못했어요. ${reason}`;
}
