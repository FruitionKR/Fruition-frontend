/**
 * 랜딩 "문서 보호" 섹션 문구(섹션 제목은 헤더 메뉴 이름을 쓴다). 법무·운영 검토가 쉽도록 문구를 이 파일 한 곳에만 둔다.
 * 운영 설정과 코드로 확인한 내용 중 문서를 지키는 방식만 쓴다. 외부 AI 제공사 전송 고지는
 * 개인정보 처리방침·AI 사전 고지에서 다룬다(랜딩에서는 제외). 근거(2026-11-03, 각 저장소 origin/main 기준):
 *
 * 보관
 * - 서울 리전: Fruition-flatform infra/terraform/variables.tf(region은 ap-northeast-2만 허용)
 * - 원본 암호화: infra/terraform/s3.tf(전용 KMS 키 aws_kms_key.storage, SSE-KMS 기본 암호화)
 * - DB·캐시·디스크 암호화: infra/terraform/rds.tf(storage_encrypted), elasticache.tf(at_rest·transit),
 *   eks.tf(노드 EBS encrypted)
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

export interface DataHandlingGroup {
  readonly id: "store" | "access" | "ai" | "delete";
  readonly title: string;
  readonly english: string;
  readonly items: readonly string[];
}

export const DATA_HANDLING_GROUPS: readonly DataHandlingGroup[] = [
  {
    id: "store",
    title: "보관",
    english: "STORAGE",
    items: [
      "문서는 AWS 서울 리전에 저장합니다.",
      "원본 파일은 전용 키로 암호화해 저장하고, 데이터베이스·캐시·서버 디스크도 암호화합니다.",
      "서버와 주고받는 데이터는 HTTPS(TLS 1.2 이상)로만 오가고, HTTP 접속은 HTTPS로 바꿉니다."
    ]
  },
  {
    id: "access",
    title: "접근",
    english: "ACCESS",
    items: [
      "문서는 워크스페이스 멤버만 볼 수 있고, 폴더나 문서마다 편집 또는 보기만 허용할 수 있습니다.",
      "권한은 화면이 아니라 서버에서 확인합니다.",
      "원본 파일은 공개되지 않은 저장소에 두고, 원본을 여는 링크는 최대 1시간 뒤 만료됩니다."
    ]
  },
  {
    id: "ai",
    title: "AI 처리",
    english: "AI PROCESSING",
    items: [
      "검색용 임베딩은 Fruition 서버 안의 모델로 만듭니다.",
      "글자로 보내는 AI 요청에서는 주민등록번호·전화번호·카드번호·계좌번호 같은 숫자 형태 개인정보를 가린 뒤 보냅니다.",
      "올리자마자 위키에 넣는 자동 편입은 기본으로 꺼져 있고, 워크스페이스 소유자만 켤 수 있습니다."
    ]
  },
  {
    id: "delete",
    title: "삭제",
    english: "DELETION",
    items: [
      "휴지통으로 옮긴 문서는 30일 동안 복구할 수 있고, 그 뒤 원본 파일과 함께 영구 삭제합니다.",
      "저장소에 남은 이전 버전 파일도 그 뒤 30일 안에 정리됩니다.",
      "문서 삭제와 복구는 문서 소유자와 워크스페이스 소유자만 할 수 있습니다."
    ]
  }
];
