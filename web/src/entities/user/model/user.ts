// GET /api/auth/me 응답
export type UserMeResponse = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  /** 로그인 수단으로 연결된 소셜 provider(이름순). 가입에 쓴 provider도 포함한다. */
  oauth_providers?: string[];
  /** 이용약관 버전이 바뀌어(또는 동의 기록이 없어) 재동의가 필요하면 true. */
  consent_required?: boolean;
};
