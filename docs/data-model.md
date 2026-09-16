# Frontend 데이터 소유권

frontend는 업무 DB·Flyway migration을 소유하지 않습니다. 서버 데이터의 원본은 Access·Document·AI입니다. UI 상태와 브라우저 저장 상태는 프론트엔드가 관리합니다.

응답 타입은 `src/entities/` 등의 코드에 정의합니다. 서버 계약을 변경할 때 타입·API 호출·관련 테스트를 함께 검증합니다. 서버의 권한 판단이나 저장소 소유권을 프론트엔드 상태로 대체하지 않습니다.
