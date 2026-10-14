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
};
