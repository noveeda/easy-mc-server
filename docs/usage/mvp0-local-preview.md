# MVP-0 로컬 실행 가이드

이 문서는 코드 실행에 필요한 최소 가이드입니다. 제품 계획, 마일스톤, 보고, 칸반은 Notion의 `마인크래프트 서버 구동기` 페이지에서 관리합니다.

- Notion 허브: https://app.notion.com/p/353892fb6fc081b993efc5363ed3f607
- 관련 Notion 문서: `MVP-0 실행 계획`, `사용법과 검증 가이드`

## 데스크톱 앱 실행

저장소 루트에서 실행합니다.

```powershell
npm.cmd run desktop:dev
```

이 명령은 Tauri 데스크톱 창을 열고 `apps/desktop` UI를 로드합니다. 개발 중에는 HTML/CSS/JS 변경이 핫로드됩니다.

순수 Cargo 실행 경로를 확인하려면 다음 명령을 사용합니다.

```powershell
npm.cmd run desktop:dev:plain
```

## 검증 명령

```powershell
npm.cmd run test
npm.cmd run desktop:check
npm.cmd run desktop:smoke
```

- `test`: JS 계약과 정적 프로토타입 검증
- `desktop:check`: Tauri/Rust 경계 컴파일 확인
- `desktop:smoke`: desktop command host와 runtime bridge 기본 동작 확인

실제 런타임 smoke:

```powershell
npm.cmd run desktop:real-smoke
```

## Node 경로 지정

Tauri 앱에서 Node를 찾지 못하면 `node.exe` 경로를 직접 지정합니다.

```powershell
$env:EASY_MC_NODE_PATH = "C:\Program Files\nodejs\node.exe"
npm.cmd run desktop:dev
```

## MVP-0 완료 기준

앱 창이 열리거나 로컬 preview가 통과해도 MVP-0 완료가 아닙니다.

MVP-0 완료는 다음 흐름이 실제로 통과했을 때만 인정합니다.

- Windows 데스크톱 앱에서 호스트가 방을 엽니다.
- 로컬 Fabric 서버가 실제로 실행됩니다.
- control plane invite가 생성됩니다.
- relay/session readiness가 완료됩니다.
- 모든 준비가 끝난 뒤에만 초대 링크가 표시됩니다.
- 친구가 모드팩 적용 후 Minecraft로 실제 접속합니다.

정적 HTML preview나 fallback 상태에서는 더미 초대 링크를 표시하면 안 됩니다.
