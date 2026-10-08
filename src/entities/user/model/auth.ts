// GET /api/auth/me 응답
export type UserMeResponse = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  /** 로그인 수단으로 연결된 소셜 provider(이름순). 가입에 쓴 provider도 포함한다. */
  oauth_providers?: string[];
};
