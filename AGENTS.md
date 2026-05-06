# AGENTS.md

## 프로젝트 기준
- 이 프로젝트는 비개발자 Minecraft 사용자가 친구들과 플레이할 로컬 호스트형 방을 쉽게 만드는 Windows 데스크톱 GUI 앱이다.
- 사용자는 서버, 포트포워딩, 방화벽, Docker, 클라우드 호스팅, 터널/NAT 같은 개념을 몰라도 방을 열고 친구를 초대할 수 있어야 한다.
- MVP-0는 Tauri 데스크톱 앱, 로컬 Fabric 서버, 고정팩, 릴레이 우선 연결, 호스트 포함 총 10명 제한을 기준으로 한다.
- Direct P2P, Forge/NeoForge, CurseForge/Prism 확장, 범용 모드 호환성 엔진, production installer는 MVP-0 이후로 둔다.
- 실제 준비가 끝나기 전에는 더미 초대 링크나 성공 상태를 표시하지 않는다.

## 런타임/보안 원칙
- Java/Fabric/server process/control plane/relay 단계는 fail-closed로 처리한다.
- 서드파티 모드는 앱 서비스가 재호스팅하지 않고 원본 허용 URL과 pinned hash를 기준으로 검증한다.
- raw invite token, session secret, UUID, IP, 로컬 경로 등 민감 정보는 UI/log/support bundle에 그대로 노출하지 않는다.
- 정적 HTML preview는 실제 서버가 열린 척하거나 더미 초대 링크를 만들면 안 된다.

## 작업 방식
- 모든 작업은 subagent를 사용해서 효율적으로 처리할 수 있으면 subagent를 사용하는 것을 우선한다.
- 작업 역할이 여러 개로 분리될 수 있는 경우에는 subagent를 사용해 역할별로 병렬 검토/작업한다.
- 단일 파일의 단순 수정처럼 병렬화 이점이 없는 작업은 메인 에이전트가 바로 처리한다.
- subagent를 쓰는 경우 역할과 책임 파일 범위를 명확히 나누고, 메인 에이전트가 결과를 검토해 통합한다.
- 기존 사용자 변경은 되돌리지 않는다. 관련 없는 dirty worktree 변경은 건드리지 않는다.
- 새 기능은 Notion의 `마인크래프트 서버 구동기` 프로젝트 허브와 기존 코드 패턴을 먼저 확인하고, 구현 범위를 작게 유지한다.
- 프로젝트 문서는 Notion을 기준으로 관리한다. 로컬 `docs/` 문서는 전환 중인 보조 자료로만 보고, 새 계획/보고/이슈 기록은 Notion의 한국어 문서명에 반영한다.
- 디자인/UI/UX 수정사항 혹은 추가사항이 생기면 Notion의 `데스크톱 앱 디자인 기준`을 먼저 확인한다. 로컬 `DESIGN.md`는 전환 중 보조 자료로만 사용한다.

## 버전관리 기준
- 작업 전 `git status --short`로 변경 상태를 확인하고, 기존 사용자 변경과 새 작업 변경을 구분한다.
- 커밋은 기능/버그/문서처럼 되돌리기 쉬운 의미 단위로 나눈다.
- 여러 이슈를 한 번에 고친 경우에도 보안 수정, UI 수정, 문서 수정은 가능하면 별도 커밋 후보로 정리한다.
- 커밋/푸시는 사용자가 명시적으로 요청했을 때만 수행하고, 관련 없는 dirty worktree 변경은 포함하지 않는다.

## 검증 기준
- JS/계약 변경 후 `npm.cmd run test`를 우선 실행한다.
- Tauri/Rust 경계 변경 후 `npm.cmd run desktop:check`를 실행한다.
- Markdown/CSS/JS 포함 모든 변경 후 `git diff --check`를 실행한다.
- 실제 Windows/Tauri/Fabric 실행은 자동 테스트만으로 완료 선언하지 말고 수동 검증 필요 여부를 보고한다.

## 참고 문서
- Notion 프로젝트 허브: https://app.notion.com/p/353892fb6fc081b993efc5363ed3f607
- Notion 문서 DB: `문서 관리`
- Notion 작업 보드: `작업 칸반`
- 로컬 `docs/`와 `DESIGN.md`는 Notion 이관이 끝난 항목부터 삭제/보관 후보로 본다.
