# Fruition Frontend

[한국어](#한국어) · [English](#english)

## 한국어

Fruition의 Next.js 웹 프론트엔드입니다. 이 저장소는 화면·API 호출·UI 테스트·frontend 문서를 소유하며 Vercel에 독립 배포합니다.

### 로컬 실행

Node.js 24를 사용합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

로그인·문서·AI 기능은 별도로 실행 중인 Access·Document API가 필요합니다. API 주소는 `.env.local`의 `ACCESS_URL`, `BACKEND_URL`로 설정합니다.

### 백엔드 없이 실행 (mock API)

실제 백엔드 없이 화면 전체를 써 보려면 mock API 서버와 함께 실행합니다. `.env.local`은 필요 없습니다.

```bash
npm ci
npm run dev:mock
```

- `mock/server.mjs`가 Access(8081)·Document(8080) 포트에서 인메모리 데이터로 응답하고, `next dev`(3000)가 함께 뜹니다. mock 서버만 띄우려면 `npm run mock`.
- 데모 계정: `demo@fruition.local` / `demo1234` (MFA 없음). 소셜 로그인 버튼도 mock 코드로 바로 로그인됩니다.
- 이메일 인증번호는 아무 6자리 숫자(또는 개발 코드 `9700`)를 입력하면 통과합니다.
- 상태는 프로세스가 살아 있는 동안만 유지되며 재시작하면 초기 데이터로 돌아갑니다. Ingest·Lint는 수 초 뒤 완료되도록 시뮬레이션합니다.
- `ACCESS_CODE`를 설정하지 않으므로 접근 코드 게이트는 꺼져 있습니다.
- mock이 처리하지 못한 요청은 `404 {"error":{"message":"mock: unhandled ..."}}`로 응답하고 터미널에 남깁니다.

### 검증

```bash
npm test
npm run build
```

같은 폴더에서 개발 서버 실행 중에는 프로덕션 빌드를 실행하지 않습니다. GitHub Actions는 전체 테스트와 빌드를 검증합니다.

### Vercel

이 GitHub 저장소를 Import하고 Framework를 Next.js, Root Directory를 저장소 루트(`.`), Node.js를 24.x로 설정합니다. Install Command는 `npm ci`, Build Command는 `npm run build`, Output Directory는 Next.js 기본값을 사용합니다.

Preview·Production별로 실제 HTTPS API 주소를 설정하고 배포합니다. `NEXT_PUBLIC_*`에는 공개 API 주소만 넣으며 비밀 키를 저장하지 않습니다. 백엔드 연결 전에는 업무 기능이 동작하지 않습니다.

자세한 구조·실행법은 [문서 안내](docs/README.md)를 참고하세요.

## English

Fruition's Next.js web frontend. This repository owns the UI, API calls, UI tests, and frontend documentation, and is deployed independently on Vercel.

### Local development

Use Node.js 24.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Authentication, document, and AI features require running Access and Document APIs. Set their URLs in `.env.local` using `ACCESS_URL` and `BACKEND_URL`.

### Running without backends (mock API)

To use the whole UI without the real backends, start the app together with the mock API server. No `.env.local` is needed.

```bash
npm ci
npm run dev:mock
```

- `mock/server.mjs` answers on the Access (8081) and Document (8080) ports with in-memory data, and `next dev` (3000) starts alongside it. Run `npm run mock` to start only the mock server.
- Demo account: `demo@fruition.local` / `demo1234` (no MFA). The social login buttons also sign in immediately with a mock code.
- Any six-digit number (or the development code `9700`) passes e-mail verification.
- State lives only for the process lifetime; restarting resets the seed data. Ingest and Lint are simulated to finish after a few seconds.
- `ACCESS_CODE` is left unset, so the access-code gate is off.
- Requests the mock does not handle return `404 {"error":{"message":"mock: unhandled ..."}}` and are logged to the terminal.

### Validation

```bash
npm test
npm run build
```

Do not run the development server and production build in the same checkout at the same time. GitHub Actions runs the full frontend test suite and production build.

### Vercel

Import this repository into Vercel. Select Next.js, use the repository root (`.`) as Root Directory, and select Node.js 24.x. Use `npm ci` as Install Command and `npm run build` as Build Command. Keep the default Next.js Output Directory.

Configure the actual HTTPS API URLs separately for Preview and Production. Only public API URLs belong in `NEXT_PUBLIC_*`; never put secret keys there. Application features require a connected backend.

See the [documentation index](docs/README.md) for architecture and execution details.

## 저작권 및 라이선스 / Copyright and License

**한국어**

저작권 (c) 2026 Fruition 팀. 모든 권리 보유.

Fruition 팀이 저작권을 보유하는 코드·문서·자산의 무단 사용을 금지합니다. 상업적·비상업적 목적의 사용·복제·수정·배포·재라이선스·판매에는 Fruition 팀의 사전 서면 허가가 필요합니다. 제3자 구성요소에는 각 라이선스가 적용됩니다. 적용 범위와 예외는 [LICENSE](LICENSE)를 참고하세요.

**English**

Copyright (c) 2026 Team Fruition. All rights reserved.

Unauthorized use of code, documentation, and assets copyrighted by Team Fruition is prohibited. Use, copying, modification, distribution, sublicensing, or sale for commercial or non-commercial purposes requires prior written permission from Team Fruition. Third-party components remain subject to their own licenses. See [LICENSE](LICENSE) for the scope and exceptions.
