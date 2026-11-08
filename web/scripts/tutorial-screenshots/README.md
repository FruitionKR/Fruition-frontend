# 튜토리얼 화면 캡처

사용 방법 모달(`src/features/tutorial`)의 단계 카드에 보이는 화면 캡처를 만듭니다. 결과는 `public/tutorial/{ko,en}/<단계 id>.webp`(960×540, 장마다 150KB 이하)입니다. 단계에 캡처를 붙이려면 `src/features/tutorial/model/tutorialContent.ts`의 단계에 `image: "<단계 id>.webp"`를 적습니다. 파일 이름·크기·용량은 `tests/tutorialImages.test.mjs`가 확인합니다.

## 준비

- **로컬 스택이 떠 있어야 합니다.** 프론트(기본 `http://localhost:3000`)와 access·document·AI 서비스가 모두 필요합니다. 캡처는 화면을 열어 찍기만 하고 서버를 재시작하지 않습니다.
- 캡처 전용 계정과 그 계정이 OWNER인 워크스페이스를 씁니다. 로그인하면 그 워크스페이스가 열려야 합니다.
- 워크스페이스에 아래 **데모 데이터**가 있어야 합니다. 이름은 언어와 상관없이 같고 `steps.mjs`의 `DOC`가 이 이름으로 찾습니다.

| 데모 데이터 | 만드는 방법 | 쓰는 단계 |
| --- | --- | --- |
| `Product Roadmap.md`, `Team Handbook.md` | 파일 업로드(위키 자동 편입이 켜져 있으면 바로 편입) | 화면 구성, 그래프, 채팅, 로그 |
| `Market Report.pdf`와 그 변환본 | PDF 업로드 → 우클릭 › Markdown으로 변환. 변환본은 **편입하지 않은 채로** 둡니다 | PDF 변환, 변환본 편입 확인 창 |
| `새 노트` (편입하지 않은 노트) | 새 노트 추가 › 새 노트 | 편입하지 않은 노트 안내 |
| `Projects` 폴더 | 새 노트 추가 › 새 폴더 | 폴더 정리 |
| 휴지통의 `Old Draft.md` | 노트를 만들어 이름을 바꾼 뒤 삭제 | 삭제와 복구 |
| 한국어·영어 질문 채팅 각 1건 | 아래 `TUTORIAL_ASK=1`로 한 번 실행 | 근거 문서와 출처 확인 |

- playwright는 앱 의존성이 아니라 캡처할 때만 설치합니다. `web/`에서:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

## 실행

`web/`에서 계정 정보를 환경변수로 넘깁니다. 스크립트에 비밀번호·토큰을 적지 않습니다.

```sh
TUTORIAL_EMAIL=<캡처 계정 이메일> TUTORIAL_PASSWORD=<비밀번호> node scripts/tutorial-screenshots/capture.mjs
```

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `TUTORIAL_BASE_URL` | `http://localhost:3000` | 프론트 주소 |
| `TUTORIAL_LOCALES` | `ko,en` | 찍을 화면 언어 |
| `TUTORIAL_ONLY` | (전체) | 쉼표로 나눈 단계 id만 다시 찍기 |
| `TUTORIAL_ASK` | (없음) | `1`이면 그 언어로 물은 채팅이 없을 때 실제로 질문을 보냅니다(LLM 비용). 없으면 그 단계는 실패로 남습니다 |

- 화면 언어는 이 브라우저의 `fruition.locale-auto` 쿠키로만 바꿉니다. 직접 고른 언어 쿠키(`fruition.locale`)는 계정에 저장되므로 쓰지 않아 계정 언어가 바뀌지 않습니다.
- 라이트 테마로 찍습니다. 개발 표시와 처리 알림 카드는 숨기고, 화면의 이메일 주소는 `member@example.com`으로 바꿔 찍습니다.
- 누를 버튼에는 `--color-primary` 테두리를 덧그립니다. 2배 밀도로 찍어 관련 영역을 16:9로 잘라 저장합니다.
- 편입 확인 창은 취소로 닫고, 위키 편입 선택 화면에서도 편입 버튼은 누르지 않습니다. 입력창에 쓴 예시 문장은 찍은 뒤 지웁니다.
- 실패한 단계는 실행한 폴더에 `tutorial-shot-failed-<언어>-<단계>.png`를 남기고 종료 코드 1로 끝납니다.

## 캡처하지 않는 단계

화면에 그대로 보이지 않는 개념 설명이거나, 찍으려면 LLM 작업·외부 서비스·순간 상태가 필요한 단계는 이미지 없이 아이콘만 보입니다: `wiki-basics`, `track-conversion`, `wiki-status-labels`, `review-edit-proposals`, `approve-plan`, `run-skill`, `save-request-as-skill`, `create-meeting-notes`, `export-from-notion`, `after-import`.

## 파일

- `capture.mjs`: 로그인, 언어 전환, 잘라내기·테두리·WebP 저장
- `steps.mjs`: 단계별로 화면을 여는 방법과 강조할 요소
- `labels.mjs`: 한국어 문구로 쓴 정의를 메시지 파일에서 같은 키의 영어 문구로 바꿉니다
