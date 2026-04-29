---
title: "로컬 마인크래프트 룸 프로젝트 진행 현황 및 향후 계획 보고서"
type: report
status: current
written_at: "2026-04-30 KST"
source_milestones: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# 로컬 마인크래프트 룸 프로젝트 진행 현황 및 향후 계획 보고서

## 1. 보고 목적

본 문서는 현재까지 구현된 작업물, 마일스톤별 진행 상태, 남은 차단 요소, 그리고 앞으로의 개발 계획을 한곳에 정리하기 위한 보고서다.

대상 제품은 비개발자 마인크래프트 유저가 친구들과 함께 플레이할 수 있는 로컬 호스트형 방을 쉽게 만들도록 돕는 데스크톱 GUI 앱이다. 사용자는 서버, 포트포워딩, 방화벽, Docker, 클라우드 호스팅 같은 개념을 몰라도 방을 열고 친구를 초대할 수 있어야 한다.

## 2. 현재 요약

- 저장소: `https://github.com/noveeda/easy-mc-server.git`
- 현재 브랜치: `codex/mvp0-decision-lock`
- 최신 커밋: `git log -1 --oneline`으로 확인
- 마지막 검증: `npm.cmd run test` 177개 통과, `npm.cmd run mvp0:preview`, `npm.cmd run mvp0:preview -- --real-launch`, `git diff --check`, `agent-browser` 정적 화면 snapshot 통과
- 현재 제품 단계: MVP-0를 위한 실행 계약에 더해 로컬 runnable developer preview를 붙이는 단계

현재 M0와 M2는 개발 게이트 기준으로 완료됐다. M3와 M4에는 로컬 파일 생성, dry-run 실행 의도, `.mrpack` blocker 검증, 로컬 TCP relay smoke를 묶는 개발자용 preview 경로가 추가되고 있다. 다만 이것은 MVP-0 완성품이 아니라 runnable developer preview다. 실제 Windows 데스크톱 앱에서 로컬 Fabric 서버를 실행하고 친구가 릴레이로 접속하는 실사용 루프는 아직 완료되지 않았다.

사용 가이드:

- `docs/usage/mvp0-local-preview.md`

프리뷰 실행 명령:

```powershell
npm.cmd run mvp0:preview
```

기본 실행은 dry-run이며 `.local/mvp0-preview` 아래에 프리뷰 산출물을 만든다. dry-run은 Java, Fabric server jar, Minecraft 서버 process, 실제 친구 접속을 실행하지 않는다.

## 3. 제품 방향

확정된 방향은 다음과 같다.

- 사용자는 데스크톱 GUI 앱에서 방을 만든다.
- 서버는 클라우드가 아니라 호스트 사용자 PC에서 실행된다.
- 친구는 초대 링크와 모드팩을 통해 접속한다.
- MVP-0에서는 릴레이 기반 연결을 기본으로 한다.
- 직접 P2P 연결은 MVP-0 이후 베타 단계로 미룬다.
- 친구는 Hamachi, Tailscale, ZeroTier, 포트포워딩, 방화벽 설정을 하지 않는다.
- 기본 UI에서는 서버, 포트, NAT, 방화벽, 터널 같은 네트워크 용어를 노출하지 않는다.
- 알파 단계 방 인원은 호스트 포함 총 10명으로 제한한다.
- 서드파티 모드는 앱 서비스가 재호스팅하지 않고 원본 허용 URL과 고정 해시를 사용한다.

## 4. 마일스톤별 진행 현황

### M0. MVP-0 의사결정 고정

상태: 완료.

완료 내용:

- MVP-0 범위와 제외 범위를 고정했다.
- 로컬 호스트형 데스크톱 앱 방향을 확정했다.
- 릴레이 우선 연결 방식을 선택했다.
- 방 총원 10명, 초대 만료, 릴레이 제한, noindex 초대 페이지, 비공식 제품 문구를 정책으로 정했다.
- Direct P2P, Forge/NeoForge, CurseForge, Prism, 일반화된 호환성 엔진은 MVP-0 범위에서 제외했다.

관련 문서:

- `docs/decisions/2026-04-29-mvp0-decision-lock.md`
- `docs/milestones/2026-04-29-local-minecraft-room-milestones.md`

### M1. 데스크톱 호스트 초대 흐름 검증

상태: 진행 중.

완료 내용:

- 데스크톱 앱 정적 프로토타입을 만들었다.
- 친구용 초대 웹 헬퍼를 만들었다.
- 고정팩 메타데이터와 검증 체크리스트를 작성했다.
- 초대 페이지에 안전 문구, 실패 상태, Modrinth 안내, noindex 정책을 반영했다.

남은 작업:

- first-party 클라이언트 연결 모드의 서명된 artifact 메타데이터가 필요하다.
- 실제 import 가능한 `.mrpack` 생성이 필요하다.
- 비개발자 테스터 3명 이상의 실사용 검증이 필요하다.
- 친구가 Modrinth App에서 팩을 가져오고 Minecraft 승인 대기 상태까지 도달하는지 확인해야 한다.

### M2. 기반 구조, 프로토콜, Control Plane

상태: 완료.

완료 내용:

- workspace 구조를 정리했다.
- host, friend, service, admin actor 권한 모델을 구현했다.
- room, invite, approval, session, TTL, permission 계약을 만들었다.
- 안전한 invite metadata 응답을 구현했다.
- HTTP boundary와 Fastify wrapper를 만들었다.
- PostgreSQL schema, repository, migration 계약을 만들었다.
- rate limit, audit event, redaction, transaction 테스트를 추가했다.

남은 작업:

- 실제 배포용 PostgreSQL 연결 설정.
- 운영 환경 인증 미들웨어.
- production deployment wiring.

판단:

- M2는 MVP-0 실행 계약 기준으로 완료로 본다.
- 남은 항목은 M2 자체 blocker가 아니라 운영 배포 작업이다.

### M3. 호스트 앱 및 로컬 룸 런타임

상태: 진행 중.

완료 내용:

- Minecraft 버전, Java, EULA, Fabric checksum, fixed pack 검증 계약을 만들었다.
- 앱 데이터 폴더 구조, cache, downloads, room files, logs, support bundles 경로 계획을 만들었다.
- Fabric Loader 선택 계약을 만들었다.
- Windows Java 감지 계획을 만들었다.
- EULA, `server.properties`, fixed pack 설치 계획을 만들었다.
- local materialization plan을 만들었다.
- 서버 process start/stop/restart intent를 만들었다.
- redacted log streaming 계약을 만들었다.
- 서버 bridge mod skeleton과 server-observed UUID 기반 승인 이벤트를 만들었다.
- approval UI 상태 모델을 만들었다.
- runtime/materialization 경로 traversal 방어를 추가했다.
- Node 기반 local runtime adapter가 preview room 파일을 실제 파일시스템에 생성하고 dry-run process intent를 반환한다.

남은 작업:

- 실제 Tauri 데스크톱 앱 shell 구현.
- Fabric server artifact 다운로드 구현.
- 다운로드 artifact checksum 검증 구현.
- Windows에서 Java/Fabric server process start/stop/restart 구현.
- 실제 로컬 Fabric 서버 시작 수동 검증.

판단:

- M3는 현재 "실행 계획과 테스트 가능한 계약"을 넘어 로컬 runnable developer preview에서 방 파일 생성까지 확인하는 단계다.
- 실제 사용자가 앱에서 방을 열 수 있으려면 M3 실구현이 다음 우선순위다.

### M4. 릴레이 기반 친구 접속 End-To-End

상태: 진행 중.

완료 내용:

- relay simulation을 구현했다.
- approved room session만 릴레이가 허용하도록 했다.
- expired, revoked, cross-room, wrong-UUID, replay, arbitrary TCP 시도를 차단한다.
- host tunnel contract를 만들었다.
- client loopback plan을 만들었다.
- echo simulation으로 친구 payload가 host stream까지 도달하는 것을 검증했다.
- 총원 10명, 6시간 세션, idle timeout, bandwidth warning/cap, monthly host cap 계약을 만들었다.
- disconnect retry와 room-language failure state를 만들었다.
- 로컬 TCP relay preview harness로 approved session의 byte forwarding과 unknown session, arbitrary target 차단을 실제 socket 수준에서 검증한다.

남은 작업:

- 실제 host app과 relay 간 authenticated stream 연결.
- 실제 client mod와 relay 간 authenticated stream 연결.
- Minecraft TCP byte forwarding 구현.
- 실제 relay/control-plane integration에서 approval-request rate limit 검증.
- 두 개의 Minecraft 클라이언트를 이용한 수동 E2E 테스트.

판단:

- M4는 local TCP preview로 socket forwarding 모양은 검증했지만, 아직 Minecraft traffic을 전달하는 제품 E2E가 아니다.
- M3가 먼저 실제 local Fabric room을 실행해야 M4 수동 검증이 가능하다.

### M5. Closed Alpha Safety Hardening

상태: 진행 중.

완료 내용:

- invite recovery state 계약을 만들었다.
- support bundle redaction 계약을 만들었다.
- mod permission metadata gate를 만들었다.
- no public discovery, noindex, referrer protection 정책을 반영했다.
- unofficial-product wording을 desktop/invite 표면에 반영했다.
- closed-alpha release gate 계약을 만들었다.
- `X-Robots-Tag`, no public discovery, invite accessibility, support redaction probe를 gate에 포함했다.
- router adapter는 trusted `deriveActor()` 없이는 실제 mount할 수 없게 막았다.
- audit metadata free-text redaction을 추가했다.
- local runtime path boundary 방어를 추가했다.
- closed-alpha release checklist 문서를 추가했다.

남은 작업:

- 실제 invite page 모바일/키보드 접근성 수동 확인.
- desktop app의 실제 support bundle export wiring.
- 실제 배포 환경에서 `X-Robots-Tag: noindex, nofollow` 확인.
- M3/M4가 끝난 뒤 closed-alpha release checklist 최종 확인.

판단:

- M5는 safety contract 측면에서는 꽤 강하게 준비됐다.
- 하지만 실제 closed-alpha release 가능 상태는 아니다. M3/M4 실구현이 선행되어야 한다.

### M6. Curated Catalog Beta

상태: 초기 계약 구현, MVP-0 이후로 보류 권장.

완료 내용:

- Modrinth-style metadata normalization 계약을 만들었다.
- metadata completeness check를 만들었다.
- curated pack output이 original URL, hash, source URL, license, permission metadata를 보존하도록 했다.
- `high_confidence`, `caution`, `likely_fail` compatibility label 계약을 만들었다.
- missing dependency와 known conflict 안내 계약을 만들었다.

남은 작업:

- 실제 Modrinth metadata ingestion.
- catalog inclusion/removal/review policy.
- reviewer/approver workflow.
- recommended/popular mod 기반 curated pack generation.
- compatibility false positive/false negative 추적.

판단:

- 현재 핵심 MVP-0 루프가 완성되지 않았으므로 M6는 뒤로 미루는 것이 맞다.

### M7. Direct P2P Beta

상태: 초기 계약 구현, MVP-0 이후로 보류 권장.

완료 내용:

- transport candidate exchange 계약을 만들었다.
- candidate expiry와 cross-room rejection 계약을 만들었다.
- safe home-network direct candidate 선택 계약을 만들었다.
- direct 실패 시 relay fallback 계약을 만들었다.

남은 작업:

- 실제 host/client direct-path adapter.
- IP privacy notice.
- direct mode opt-in/default 정책.
- direct success/fallback/latency/disconnect/relay byte metrics.
- friendly network와 restricted network 수동 테스트.

판단:

- MVP-0에서는 direct P2P를 하지 않는다.
- relay metric이 쌓인 뒤 비용이나 지연 문제가 명확해졌을 때 진행하는 것이 맞다.

## 5. 현재 구현 자산

| 영역 | 현재 자산 |
|---|---|
| Desktop host UI | `apps/desktop` 정적 프로토타입과 runtime 계약 |
| Invite helper | `apps/invite-web` 친구 초대 페이지 |
| Control plane | room/invite/approval/session simulation, HTTP boundary, Fastify wrapper, PostgreSQL 계약 |
| Relay | relay simulation, quota, replay refusal, open-proxy guard |
| MVP-0 local preview | `.local/mvp0-preview` 산출물, dry-run process intent, `.mrpack` blocker 검증, local TCP relay smoke |
| Client mod | Fabric client connection mod skeleton, loopback plan |
| Server bridge mod | Fabric server bridge skeleton, approval/allowlist 계약 |
| Safety | invite, support redaction, mod policy, release gate, accessibility 계약 |
| Modpack builder | fixed pack template, permission policy guardrail |
| Catalog | 초기 metadata/compatibility 계약 |

## 6. 검증 현황

마지막 검증 결과:

- `npm.cmd run test`: 158개 테스트 통과
- `git diff --check`: 통과
- 최신 커밋은 원격 브랜치에 push 완료

자동 테스트로 검증된 항목:

- protocol permission
- safe invite metadata
- control-plane room/invite/approval/session flow
- HTTP DTO redaction
- PostgreSQL repository contract
- relay authorization, quota, open-proxy guard, replay refusal
- desktop runtime planning
- local path boundary validation
- client loopback plan
- host tunnel contract
- invite helper state rendering
- support bundle redaction
- mod permission policy gate
- closed-alpha release gate

아직 수동 검증이 필요한 항목:

- `npm.cmd run mvp0:preview` runnable preview 명령 실행 확인
- Windows 데스크톱 앱 실제 실행
- Java/Fabric 서버 실제 시작
- Minecraft 클라이언트 실제 접속
- Modrinth App `.mrpack` 실제 import
- invite page 모바일/키보드 접근성
- 실제 support bundle export UX

## 7. 주요 차단 요소

### 7.1 Importable Friend Pack 미완성

현재 fixed pack template은 import 가능한 `.mrpack`이 아니다. preview는 이 blocker를 명시적으로 검증해야 하며, first-party client connection mod의 서명된 artifact metadata가 준비되기 전에는 `.mrpack` 생성이 fail-closed로 남아야 한다.

영향:

- M1 친구 온보딩 실사용 검증 불가.
- M4 실제 친구 접속 검증 불가.

### 7.2 실제 Desktop Runtime 미완성

현재 M3는 runtime contract와 static GUI prototype에 더해 로컬 preview 파일 생성 adapter를 갖춘 상태다. 그러나 제품 앱에서 실제 Fabric 서버를 실행하는 단계는 아직 아니다.

영향:

- 사용자가 앱에서 실제 Fabric 서버를 시작할 수 없다.
- closed alpha를 시작할 수 없다.

### 7.3 실제 Relay Socket 미완성

현재 M4는 simulation, executable contract, local TCP relay preview harness 단계다. 그러나 deployed relay와 host/client authenticated stream이 연결된 제품 경로는 아니다.

영향:

- 친구가 실제 relay를 통해 host room에 접속할 수 없다.
- Minecraft traffic 기준 latency/disconnect 검증이 불가능하다.

### 7.4 Closed Alpha Safety는 계약 준비 상태

M5의 안전 계약은 준비됐지만 release-complete는 아니다.

영향:

- safety gate는 다음 개발을 보호할 수 있다.
- 그러나 실제 사용자 초대는 아직 이르다.

## 8. 향후 개발 계획

### 8.1 1순위: M3 실제 데스크톱 런타임 완성

목표:

정적 프로토타입, runtime plan, runnable preview adapter를 실제 Windows 데스크톱 앱 실행 경로로 연결한다.

작업:

- Tauri desktop shell 구성.
- 현재 `apps/desktop` UI를 실제 앱 shell에 연결.
- local materialization adapter 구현.
- Java detection 구현.
- Fabric artifact download 구현.
- checksum verification 구현.
- local Fabric server process start/stop/restart 구현.
- redacted log streaming을 UI에 연결.
- server bridge approval event를 approval panel에 연결.

완료 기준:

- Windows 앱에서 방 폴더 생성.
- EULA, server properties, mods, bridge config 생성.
- 로컬 Fabric 서버 시작.
- 누락 Java, checksum failure, crash 상태 복구 UI 표시.
- 수동 host-only local server run 통과.

### 8.2 2순위: First-party Pack Artifact 및 `.mrpack` 생성

목표:

친구가 Modrinth App으로 가져올 수 있는 실제 private `.mrpack`을 만든다.

작업:

- client connection mod 서명된 artifact 생성.
- server bridge mod 서명된 artifact 생성.
- SHA1/SHA512, immutable version, rollback, revocation metadata 작성.
- fixed pack template의 placeholder 제거.
- private `.mrpack` 생성.
- Modrinth App import 검증.

완료 기준:

- `.mrpack`이 Modrinth App에 import된다.
- 친구 client가 connection mod를 포함한 상태로 Minecraft를 실행한다.
- 서드파티 모드 재호스팅이 없다.

### 8.3 3순위: M4 실제 릴레이 접속 완성

목표:

simulation을 실제 relay stream 연결로 전환한다.

작업:

- host app과 relay 간 authenticated tunnel 구현.
- client mod와 relay 간 authenticated stream 구현.
- Minecraft TCP byte forwarding 구현.
- stream open 시 control-plane session validation 사용.
- real path에서 quota, replay refusal, open-proxy guard 적용.
- manual two-client Minecraft test script 작성.

완료 기준:

- 친구가 relay를 통해 host local room에 접속한다.
- expired/revoked/wrong-room/wrong-UUID/replay/arbitrary TCP가 실패한다.
- relay metrics가 active room, byte, disconnect, quota stop을 기록한다.

### 8.4 4순위: M1/M5 사람 검증 및 Closed Alpha 준비

목표:

비개발자 기준으로 실제 제품 흐름이 이해되는지 검증한다.

작업:

- 비개발자 host/friend 테스트 3회 이상.
- invite open, Modrinth import, Minecraft launch, approval wait, host approval 단계별 drop-off 기록.
- invite page 모바일/키보드 접근성 수동 확인.
- desktop support bundle export 구현.
- 배포된 invite helper의 `X-Robots-Tag` 확인.

완료 기준:

- tester가 서버/네트워크 설명 없이 흐름을 완료한다.
- support bundle에 raw token, invite URL, session credential, IP, device signal이 남지 않는다.
- closed-alpha release checklist가 모두 통과한다.

### 8.5 M6/M7은 MVP-0 이후 진행

M6 curated catalog와 M7 direct P2P는 현재 진행하지 않는 것이 좋다.

이유:

- 아직 사용자가 실제로 방을 열고 친구가 들어오는 기본 루프가 완성되지 않았다.
- catalog와 direct P2P는 제품 폭을 넓히지만 MVP-0의 핵심 차단 요소를 해결하지 않는다.
- 먼저 "한 방이 안정적으로 열린다"는 것을 증명해야 한다.

## 9. 다음 스프린트 추천

다음 스프린트는 M3에 집중한다.

권장 순서:

1. Tauri desktop shell 구성.
2. 현재 desktop prototype을 실제 앱 shell로 연결.
3. preview local materialization adapter를 Tauri 파일 쓰기 경로로 연결.
4. Java detection 구현.
5. Fabric download/checksum verification 구현.
6. local Fabric server process start 구현.
7. host-only manual Windows run 수행.
8. 이후 `.mrpack` artifact 작업과 M4 real relay socket 작업으로 이동.

## 10. 현재 제품 준비도 평가

| 항목 | 상태 | 설명 |
|---|---|---|
| 제품 방향 | 준비됨 | 로컬 데스크톱 호스트 룸, relay-first MVP-0 |
| 핵심 계약 | 강함 | M2와 M3-M5 다수 계약이 테스트됨 |
| 데스크톱 UX | 부분 준비 | 정적 prototype 존재, 실제 Tauri shell 필요 |
| 로컬 서버 런타임 | 부분 준비 | preview 파일 생성과 dry-run intent 존재, 실제 process 실행 필요 |
| 릴레이 경로 | 부분 준비 | simulation과 local TCP preview 존재, 제품 relay stream 필요 |
| 친구 설치 경로 | 차단됨 | importable `.mrpack` 전 first-party artifact 필요 |
| 안전 정책 | 계약 준비됨 | release checklist와 safety gate 존재 |
| 실사용 테스트 | 아직 불가 | M3, M4, `.mrpack` 선행 필요 |

## 11. 결론

현재 프로젝트는 문서 기획 단계는 넘어섰고, MVP-0의 핵심 구조와 안전 계약은 상당 부분 코드와 테스트로 옮겨졌다. 다만 아직 사용자가 실제로 앱을 실행해서 방을 열고 친구가 Minecraft로 접속하는 제품 루프는 완성되지 않았다.

따라서 다음 개발의 핵심은 M3 실제 데스크톱 런타임이다. 이 작업이 끝나야 `.mrpack` 검증, M4 실제 릴레이 접속, M1 비개발자 테스트, M5 closed-alpha release 검증이 순서대로 가능해진다.

최우선 목표는 기능을 넓히는 것이 아니라, 하나의 고정팩과 하나의 Minecraft 버전으로 host가 방을 열고 friend가 relay로 들어오는 첫 번째 완성 루프를 만드는 것이다.
