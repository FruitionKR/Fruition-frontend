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
