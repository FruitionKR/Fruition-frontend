/**
 * 랜딩 "문서 보호" 섹션 문구(섹션 제목은 헤더 메뉴 이름을 쓴다). 법무·운영 검토가 쉽도록 문구를 이 파일 한 곳에만 둔다.
 * 운영 설정과 코드로 확인한 내용 중 문서를 지키는 방식만 쓴다. 외부 AI 제공사 전송 고지는
 * 개인정보 처리방침·AI 사전 고지에서 다룬다(랜딩에서는 제외). 근거(2026-11-03, 각 저장소 origin/main 기준):
 *
 * 보관
 * - 서울 리전: Fruition-flatform infra/terraform/variables.tf(region은 ap-northeast-2만 허용)
 * - 원본 암호화: infra/terraform/s3.tf(전용 KMS 키 aws_kms_key.storage, SSE-KMS 기본 암호화)
 * - DB·캐시·디스크 암호화: infra/terraform/rds.tf(storage_encrypted), elasticache.tf(at_rest·transit),
 *   eks.tf(노드 EBS encrypted), k8s/platform/aws/storage-class.yaml(Kafka PVC gp3 encrypted)
 * - 임베딩 "외부로 보내지 않습니다"는 임베딩에만 해당한다(외부 임베딩 API 호출 없음).
 * - HTTPS: k8s/overlays/aws/ingress.yaml(ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06, ssl-redirect 443),
 *   s3.tf(DenyInsecureTransport)
 * 접근
 * - 멤버·폴더/문서별 편집·보기: Fruition-document DocumentAccessPolicy.java, WorkspaceAccessGuard.java
 * - 비공개 저장소: s3.tf(public access block 전부 true)
 * - 원본 링크 1시간: DocumentService.originalReadUrl(expiry 3600)
 * AI 처리
 * - 임베딩: Fruition-ai pipeline/Dockerfile(BGE-M3 이미지 내장), Fruition-flatform k8s/base/embedding-server.yaml
 * - 숫자 개인정보 가림: pipeline/app/core/llm_prompt.py(redact_numeric_personal_data),
 *   wiki_generation/infrastructure/chat_completions_llm.py(complete_text의 user 입력).
 *   PDF 복원(페이지 이미지)과 음성은 이 처리를 거치지 않아 "글자로 보내는 AI 요청"으로 범위를 적는다.
 * - 자동 편입 기본 꺼짐·소유자만 변경: Fruition-access V25 마이그레이션(DEFAULT false),
 *   WorkspaceService.rename(findOwned)
 * 삭제
 * - 휴지통 30일 뒤 원본과 함께 삭제: Fruition-document DocumentTrashPurgeWorker.java(app.document-trash.retention 30d)
 * - 이전 버전 정리: s3.tf(expire-noncurrent-versions, noncurrent_days 30)
 * - 삭제·복구 권한: DocumentAccessPolicy.java(문서 소유자와 워크스페이스 OWNER)
 */

// 문구는 언어별 메시지(src/shared/i18n/messages/{ko,en}/landing.json의 dataHandling)에 있고, 여기에는 순서와 키만 둔다.
// 영어 문구도 위 근거 범위를 넘지 않게 쓴다(tests/landingDataHandling.test.mjs).

export type DataHandlingItemId =
  | "region"
  | "encryption"
  | "https"
  | "members"
  | "serverCheck"
  | "privateStorage"
  | "embedding"
  | "redaction"
  | "autoIngestOff"
  | "trash"
  | "versions"
  | "deletePermission";

export interface DataHandlingGroup {
  /** landing.dataHandling.groups 아래 키. 묶음 이름(보관·접근·AI 처리·삭제)과 한 줄 제목(h3)이 있다. */
  readonly id: "store" | "access" | "ai" | "delete";
  /** 묶음 이름과 함께 작은 글자로 쓰는 영어 부제 */
  readonly english: string;
  /** landing.dataHandling.items 아래 키 */
  readonly items: readonly DataHandlingItemId[];
}

export const DATA_HANDLING_GROUPS: readonly DataHandlingGroup[] = [
  { id: "store", english: "STORAGE", items: ["region", "encryption", "https"] },
  { id: "access", english: "ACCESS", items: ["members", "serverCheck", "privateStorage"] },
  { id: "ai", english: "AI PROCESSING", items: ["embedding", "redaction", "autoIngestOff"] },
  { id: "delete", english: "DELETION", items: ["trash", "versions", "deletePermission"] }
];
