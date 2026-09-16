# Frontend 빌드·실행

모든 명령은 이 저장소 루트에서 Node.js 22로 실행합니다. 설치 버전은 `package-lock.json`을 따릅니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

개발 서버의 기본 주소는 `http://localhost:3000`입니다. `.env.local`에서 Access·Document 주소를 지정합니다. 값 변경 후 개발 서버를 재시작합니다.

| 환경변수 | 로컬 기본값 | 대상 |
|---|---|---|
| `NEXT_PUBLIC_ACCESS_URL` | `http://localhost:8081` | 인증·워크스페이스·멤버·초대 |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8080` | 문서·Wiki·채팅·AI 업무 API |

`npm test`는 `tests/*.test.mjs` 전체를 실행합니다. 특정 영역은 `package.json`의 `test:*` 명령으로 확인합니다.

```bash
npm test
npm run build
npm start
```

같은 폴더의 개발 서버를 종료한 뒤 프로덕션 빌드를 실행합니다. GitHub Actions는 Node.js 22에서 `npm ci` → `npm test` → `npm run build` 순서로 검증합니다.

Vercel에서는 Root Directory를 저장소 루트(`.`), Framework를 Next.js, Node.js를 22.x로 설정합니다. 설치·빌드 명령은 각각 `npm ci`, `npm run build`이며 Output Directory는 기본값입니다. Preview와 Production에 맞는 실제 HTTPS API 주소를 설정하고, 환경변수 변경 후 새로 배포합니다. `localhost`는 배포된 백엔드 주소로 사용할 수 없습니다.

비밀값과 실제 환경 파일은 Git에 올리지 않습니다. AWS 리소스·DB·서비스 통합 실행은 별도 platform 저장소가 관리합니다.
