# 인증·계정 소비 API

[API 배선 문서](../README.md) / [소비 API](README.md)

access-svc의 `/api/auth/**`를 호출한다. 이 경로군은 `next.config.mjs` rewrite로 access-svc에
전달되며, 직접 전송 정규식에 포함되지 않으므로 항상 동일 출처 rewrite를 경유한다.

- 호출 지점: 21 (`apiFetch` 12, raw `fetch` 9)
- 호출 경로: 17 — access-svc `/api/auth/**` 전체

로그인·회원가입처럼 아직 토큰이 없는 요청은 Bearer를 붙일 필요가 없어 raw `fetch`를 쓴다.
`/api/auth/me**`는 보호된 요청이므로 `apiFetch`를 쓴다.

## 세션

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/auth/login` | 이메일·비밀번호 로그인 | `src/entities/user/api/login.ts` `login` | 리터럴 | JSON 자격 증명 | 토큰·MFA 요구 여부 | raw `fetch`. 토큰이 없는 요청이므로 Bearer 미부착 |
| `POST /api/auth/login/mfa` | MFA 코드로 로그인 완결 | `src/entities/user/api/mfa.ts` `loginWithMfa` | 리터럴 | JSON 코드 | 토큰 | raw `fetch` |
| `POST /api/auth/logout` | 서버 세션 종료 | `src/entities/user/api/login.ts` `logout` | 리터럴 | 본문 없음 | - | raw `fetch`. 응답을 보지 않고 로컬 토큰을 지운다 |
| `POST /api/auth/refresh` | access token 재발급 | `src/shared/api/client.ts` `tryRefreshTokens` | 리터럴 | 본문 없음(쿠키 기반) | `access_token` | `apiFetch` 내부에서 raw `fetch`로 호출한다. 진행 중 promise 공유 + `withAuthRefreshLock` |
| `POST /api/auth/oauth/exchange` | OAuth 콜백 코드를 토큰으로 교환 | `src/entities/user/api/login.ts` `exchangeOauth` | 리터럴 | JSON | 토큰 | raw `fetch`. OAuth 시작은 `/oauth2/authorization/:provider` 서버 리다이렉트로 access-svc 오리진으로 직접 보낸다 |

## 회원가입·이메일 인증

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `POST /api/auth/email-availability` | 이메일 중복 확인 | `src/entities/user/api/emailVerification.ts` `checkEmailAvailability` | 리터럴 | `{ email }` | 가용 여부 | raw `fetch` |
| `POST /api/auth/email-verifications` | 인증번호 발송 요청 | `src/entities/user/api/emailVerification.ts` `requestEmailVerification` | 리터럴 | `{ email, purpose }` (`signup`/`password_reset`/`email_change`) | `verification_id`, `expires_in` | raw `fetch` |
| `POST /api/auth/email-verifications/{verification_id}/confirm` | 인증번호 검증 | `src/entities/user/api/emailVerification.ts` `confirmEmailVerification` | 템플릿 결합 (`` `/api/auth/email-verifications/${encodeURIComponent(verificationId)}/confirm` ``) | `{ code }` | 검증 토큰 | raw `fetch`. 경로 리터럴이 아니라 템플릿이다 |
| `POST /api/auth/signup` | 회원가입 | `src/entities/user/api/emailVerification.ts` `signupWithEmail` | 리터럴 | `{ email, password, display_name, verification_token }` | - (본문 미사용) | raw `fetch`. `throwIfNotOk` |
| `POST /api/auth/password-reset` | 인증 토큰으로 비밀번호 재설정 | `src/entities/user/api/emailVerification.ts` `resetPasswordWithVerification` | 리터럴 | `{ email, new_password, verification_token }` | - (본문 미사용) | raw `fetch`. `throwIfNotOk` |

## 내 계정

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/auth/me` | 내 정보 조회 | `src/entities/user/api/account.ts` `fetchMe` | 리터럴 | `cache: no-store` | 사용자 프로필 | `apiFetch`. `/api/auth/` 하위인데도 재발급 대상으로 예외 처리된 경로 |
| `PATCH /api/auth/me` | 프로필 수정 | `src/entities/user/api/account.ts` `updateMe` | 리터럴 | JSON | 갱신된 프로필 | `apiFetch` |
| `PUT /api/auth/me/password` | 비밀번호 변경 | `src/entities/user/api/account.ts` `changePassword` | 리터럴 | JSON | - | `401` + `INVALID_CREDENTIALS`는 재발급하지 않고 그대로 올린다 |
| `PUT /api/auth/me/email` | 이메일 변경 | `src/entities/user/api/account.ts` `changeEmail` | 리터럴 | JSON (인증 토큰 포함) | - | `apiFetch` |

## MFA

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/auth/me/mfa` | MFA 설정 상태 조회 | `src/entities/user/api/mfa.ts` `fetchMfaStatus` | 리터럴 | `cache: no-store` | 활성 여부 | `apiFetch` |
| `POST /api/auth/me/mfa` | MFA 등록 시작(시크릿 발급) | `src/entities/user/api/mfa.ts` `startMfaEnrollment` | 리터럴 | 본문 없음 | 시크릿·QR 정보 | `401` + `INVALID_MFA_CODE`는 재발급 대상 제외 |
| `POST /api/auth/me/mfa/activate` | 코드 확인 후 MFA 활성화 | `src/entities/user/api/mfa.ts` `activateMfa` | 리터럴 | JSON 코드 | 활성 결과 | `401` + `INVALID_MFA_CODE`는 재발급 대상 제외 |
| `DELETE /api/auth/me/mfa` | MFA 해제 | `src/entities/user/api/mfa.ts` `disableMfa` | 리터럴 | JSON 코드 | - | `401` + `INVALID_MFA_CODE`는 재발급 대상 제외 |

## 로그인 기기

| 메서드 + 경로 | 목적 | 호출 모듈 | 경로 생성 | 보내는 것 | 쓰는 응답 필드 | 비고 |
|---|---|---|---|---|---|---|
| `GET /api/auth/me/sessions` | 활성 세션 목록 | `src/entities/user/api/sessions.ts` `fetchSessions` | 리터럴 | `cache: no-store` | 세션 목록 | `apiFetch` |
| `DELETE /api/auth/me/sessions/{session_id}` | 특정 세션 종료 | `src/entities/user/api/sessions.ts` `revokeSession` | 템플릿 결합 (`encodeURIComponent(sessionId)`) | 본문 없음 | - | `apiFetch` |

## UI 위치

- 로그인·회원가입: `src/views/login/ui`, `src/views/auth`
- 계정·MFA·기기 설정: `src/features/user-settings/ui/panels`
