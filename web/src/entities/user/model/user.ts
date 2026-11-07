// GET /api/auth/me 응답
export type UserMeResponse = {
  id: string;
  email: string;
  display_name: string | null;
  /** 프로필 사진 조회 경로(`/api/users/{id}/avatar?v={hash}`). 사진이 없으면 null이라 이니셜 상자를 보여 준다. */
  avatar_url?: string | null;
  created_at: string;
  /** 로그인 수단으로 연결된 소셜 provider(이름순). 가입에 쓴 provider도 포함한다. */
  oauth_providers?: string[];
  /** 이용약관 버전이 바뀌어(또는 동의 기록이 없어) 재동의가 필요하면 true. */
  consent_required?: boolean;
  /** 비밀번호로 로그인할 수 있는 계정인지. 탈퇴·이메일 변경의 본인 확인 방법이 갈린다. 구 서버에는 없다. */
  has_password?: boolean;
  /** 계정에 저장한 화면 언어. 아직 고른 적이 없으면 null, 언어 저장을 모르는 구 서버면 필드가 없다. */
  locale?: "ko" | "en" | null;
};
