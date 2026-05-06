# 마인크래프트 서버 구동기

비개발자 Minecraft 사용자가 서버, 포트포워딩, 방화벽, Docker, 클라우드 호스팅을 몰라도 Windows 데스크톱 앱에서 친구들과 플레이할 로컬 방을 열 수 있게 만드는 프로젝트입니다.

## 문서 기준

프로젝트 진행 문서는 Notion을 기준으로 관리합니다.

- Notion 허브: https://app.notion.com/p/353892fb6fc081b993efc5363ed3f607
- 문서 DB: `문서 관리`
- 작업 보드: `작업 칸반`

로컬에는 코드 작업에 바로 필요한 최소 문서만 둡니다.

- `AGENTS.md`: 에이전트 작업 기준
- `DESIGN.md`: 디자인 기준 요약과 Notion 링크
- `docs/README.md`: 로컬 문서 정책
- `docs/architecture/`: 코드와 함께 버전 관리해야 하는 계약 문서
- `docs/usage/`: 실행과 검증에 필요한 최소 가이드

## 현재 MVP-0 기준

- Windows Tauri 데스크톱 앱
- Minecraft `1.21.1`
- Fabric 고정팩
- 로컬 호스트 PC에서 서버 실행
- 릴레이 우선 연결
- 호스트 포함 총 10명 제한

MVP-0에서는 Direct P2P, Forge/NeoForge, CurseForge/Prism 확장, 범용 모드 호환성 엔진, production installer를 다루지 않습니다.

## 실행

```powershell
npm.cmd run desktop:dev
```

기본 검증:

```powershell
npm.cmd run test
npm.cmd run desktop:check
npm.cmd run desktop:smoke
```

현재 앱은 개발 중인 MVP-0 데스크톱 프로그램입니다. 실제 MVP-0 완료는 호스트가 방을 열고 친구가 실제 Minecraft로 접속하는 end-to-end 흐름을 통과했을 때만 인정합니다.
