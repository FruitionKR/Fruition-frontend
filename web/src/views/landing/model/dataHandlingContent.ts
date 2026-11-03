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

export interface DataHandlingGroup {
  readonly id: "store" | "access" | "ai" | "delete";
  /** 묶음 이름(보관·접근·AI 처리·삭제). 영어 부제와 함께 작은 글자로 쓴다. */
  readonly title: string;
  readonly english: string;
  /** 왜 안전한지 한 줄로 말하는 묶음 제목(h3) */
  readonly headline: string;
  readonly items: readonly string[];
}

export const DATA_HANDLING_GROUPS: readonly DataHandlingGroup[] = [
  {
    id: "store",
    title: "보관",
    english: "STORAGE",
    headline: "잠긴 채로 보관합니다",
    items: [
      "문서는 AWS 서울 리전에 보관합니다.",
      "원본 파일은 전용 암호화 키로 잠가 두고, 데이터베이스·캐시·서버 디스크까지 모두 암호화해 저장 장치의 데이터만으로는 키 없이 내용을 읽을 수 없게 했습니다.",
      "서버와 주고받는 모든 데이터는 암호화된 연결(HTTPS, TLS 1.2 이상)로만 오가고, 암호화되지 않은 접속은 자동으로 HTTPS로 바꿉니다."
    ]
  },
  {
    id: "access",
    title: "접근",
    english: "ACCESS",
    headline: "허락한 사람만 볼 수 있습니다",
    items: [
      "워크스페이스 멤버가 아니면 문서를 볼 수 없고, 폴더와 문서마다 편집·보기 권한을 나눠 줄 수 있습니다.",
      "권한 확인은 화면이 아니라 서버에서 이뤄집니다.",
      "원본 파일은 공개 주소가 없는 비공개 저장소에 두고, 원본을 여는 링크도 최대 1시간 뒤 만료돼 링크가 퍼져도 오래 쓰일 수 없습니다."
    ]
  },
  {
    id: "ai",
    title: "AI 처리",
    english: "AI PROCESSING",
    headline: "AI에는 필요한 만큼만",
    items: [
      "검색을 위한 문서 분석(임베딩)은 Fruition 서버 안의 모델로 처리해 외부로 보내지 않습니다.",
      "글자로 보내는 AI 요청에서는 주민등록번호·전화번호·카드번호·계좌번호 같은 숫자 형태 개인정보를 자동으로 가린 뒤 보냅니다.",
      "올리자마자 AI가 처리하는 자동 편입은 기본으로 꺼져 있어, 워크스페이스 소유자가 켜기 전에는 시작되지 않습니다."
    ]
  },
  {
    id: "delete",
    title: "삭제",
    english: "DELETION",
    headline: "지울 때도 안전하게",
    items: [
      "실수로 지워도 30일 동안 휴지통에서 되살릴 수 있고, 그 뒤에는 원본 파일까지 영구 삭제합니다.",
      "저장소에 남은 이전 버전 파일도 그 뒤 30일 안에 정리합니다.",
      "삭제와 복구는 문서 소유자와 워크스페이스 소유자만 할 수 있어, 다른 멤버가 함부로 지울 수 없습니다."
    ]
  }
];
