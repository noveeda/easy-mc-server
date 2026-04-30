---
title: "MVP-0 로컬 runnable preview 사용 가이드"
type: usage
status: current
written_at: "2026-04-30 KST"
source_plan: "../plans/2026-04-30-002-feature-m3-real-runtime-bootstrap-plan.md"
---

# MVP-0 로컬 runnable preview 사용 가이드

## 현재 상태

이 프리뷰는 MVP-0 완성품이 아니라 runnable developer preview다.

목적은 "호스트가 로컬 방 파일을 준비하고, 서버 실행 의도를 확인하고, Java/Fabric bootstrap adapter 상태를 확인하고, 친구 팩 차단 조건을 검증하고, 로컬 릴레이 byte forwarding smoke를 확인한다"는 개발자용 실행 경로를 한 번에 점검하는 것이다. 아직 비개발자 테스터에게 배포할 Windows 앱, import 가능한 `.mrpack`, 배포된 릴레이 서비스, 실제 Minecraft 두 클라이언트 E2E는 아니다.

데스크톱 GUI 쪽은 bridge-shaped command contract를 사용하도록 연결됐다. 파일로 여는 정적 미리보기에서는 `bridge.js`가 안전한 fallback을 사용하며, `방 열기`를 눌러도 실제 서버가 열린 척하지 않고 "데스크톱 앱 연결 필요" blocker를 보여준다. 실제 Java/Fabric 실행은 future Tauri command가 같은 bridge DTO를 구현한 뒤 검증해야 한다.

## 실행 명령

Windows PowerShell에서 저장소 루트 기준으로 실행한다.

```powershell
npm.cmd run mvp0:preview
```

기본 실행은 dry-run preview다. 외부 다운로드, Java 실행, Fabric 서버 실행, Minecraft 실행을 요구하지 않는다.

실제 실행 쪽 blocker를 더 자세히 보려면 다음 명령을 실행한다.

```powershell
npm.cmd run mvp0:preview -- --real-launch
```

Fabric server jar 다운로드까지 시도하는 옵션도 있지만, 현재 프리뷰 manifest에는 실제 pinned SHA256이 아니라 preview placeholder가 남아 있으므로 다운로드 전에 blocked 되는 것이 정상이다.

```powershell
npm.cmd run mvp0:preview -- --real-launch --download-fabric
```

## 생성 경로

프리뷰 출력물은 저장소 루트 아래 `.local/mvp0-preview`에 생성된다.

주요 생성물은 다음과 같다.

- `.local/mvp0-preview/rooms/mvp0-room/eula.txt`: 프리뷰용 EULA 동의 파일
- `.local/mvp0-preview/rooms/mvp0-room/server.properties`: 고정 방 설정
- `.local/mvp0-preview/rooms/mvp0-room/whitelist.json`: 기존 파일이 있으면 보존되는 allowlist
- `.local/mvp0-preview/rooms/mvp0-room/runtime/server-bridge.json`: 서버 bridge 설정
- `.local/mvp0-preview/rooms/mvp0-room/runtime/room-runtime-manifest.json`: Minecraft/Fabric/팩 메타데이터
- `.local/mvp0-preview/rooms/mvp0-room/mods`: 프리뷰용 고정팩 파일 복사 위치
- `.local/mvp0-preview/cache/downloads`, `.local/mvp0-preview/cache/metadata`: 이후 실제 런타임 adapter가 사용할 cache 디렉터리

이 경로는 개발자 프리뷰 산출물이다. 릴리스 artifact나 사용자 데이터 저장 위치로 간주하지 않는다.

## dry-run 의미

dry-run은 방 실행에 필요한 파일 생성과 실행 의도 계산까지만 수행한다.

- 실제 Java process를 spawn하지 않는다.
- Fabric server jar를 다운로드하지 않는다.
- Minecraft 서버를 열지 않는다.
- 친구가 접속할 수 있는 실제 방을 만들지 않는다.
- 로컬 릴레이 preview는 테스트용 TCP echo target으로 byte forwarding 모양만 확인한다.

따라서 dry-run이 성공해도 "MVP-0 완료"나 "closed alpha 배포 가능"을 의미하지 않는다.

## real launch 조건

실제 Fabric 서버 실행은 dry-run과 별개 조건을 모두 만족해야 한다.

```powershell
npm.cmd run mvp0:preview -- --real-launch
```

위 명령은 실제 실행을 요청하지만, 현재 저장소에서는 필요한 외부 artifact가 없으면 blocked 상태를 출력해야 한다.
blocked는 현재 프리뷰의 예상 가능한 상태이므로 명령 자체는 성공 종료 코드로 끝난다. 자동화에서는 최종 요약의 `Java/Fabric launch path: blocked` 문구를 실제 실행 미완료 신호로 보면 된다.

- Windows 데스크톱 앱 또는 Tauri process adapter가 실제 실행 경로에 연결되어 있어야 한다.
- Desktop runtime bridge DTO는 준비됐지만, 실제 Tauri command 등록과 packaged app 실행은 아직 남아 있다.
- Java 21 호환 런타임을 감지해야 한다. 현재 Node adapter는 `configuredPath`, `JAVA_HOME`, `PATH`, Program Files 계열 후보를 검사할 수 있지만, 실제 실행 preview는 보안을 위해 PATH와 네트워크 경로 후보를 제외하고 신뢰된 설치 경로만 사용한다.
- 지원 Minecraft 버전은 현재 MVP-0 고정값인 `1.21.1`이어야 한다.
- Fabric Loader와 Fabric server jar가 app-approved source에서 내려받아져야 한다. 현재 Node adapter는 Fabric Meta server jar URL만 허용한다.
- Fabric server jar checksum이 고정값과 일치해야 한다. placeholder나 64자리 SHA256이 아닌 값은 다운로드 전에 blocked 된다.
- EULA 동의가 명시적으로 저장되어야 한다.
- 고정팩 mod 파일이 검증된 source에서 설치되어야 한다.
- 서버 bridge mod와 client connection mod의 signed first-party artifact가 준비되어야 한다.
- 실제 local Fabric server start/stop/restart와 redacted log streaming이 수동 검증되어야 한다. 현재 Node lifecycle adapter는 fake process 테스트로 start, stop, restart, duplicate start 차단, child process error, ready/crash log, split log chunk, redaction, stop timeout을 검증한다.

이 조건이 하나라도 빠지면 real launch는 실패하거나 blocked 상태로 취급해야 한다.

## `.mrpack`이 아직 blocked인 이유

현재 `packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json`은 import 가능한 `.mrpack`이 아니라 template이다.

차단 이유는 first-party client connection mod artifact가 아직 placeholder이기 때문이다. `.mrpack`을 만들려면 first-party artifact마다 다음 정보가 필요하다.

- 변경 불가능한 HTTPS 다운로드 URL
- SHA1
- SHA512
- 파일 크기
- 서명 또는 릴리스 provenance를 확인할 수 있는 버전 메타데이터

서드파티 모드는 원본 허용 URL, 고정 해시, 파일 크기가 MVP-0 fixed pack lock과 정확히 일치해야 하며, 앱 서비스가 재호스팅하지 않는다. placeholder가 남아 있거나 허용되지 않은 HTTPS 다운로드 URL로 바뀐 상태에서 template을 zip으로 묶으면 친구 설치 경로를 속이는 결과가 되므로 pack generator는 fail-closed로 동작해야 한다.

## 실제 MVP-0 완료 조건

MVP-0 완료는 runnable preview 성공보다 훨씬 좁고 구체적인 사용자 루프가 통과했을 때만 인정한다.

- Windows 앱에서 호스트가 방을 만들고 로컬 Fabric 서버를 시작한다.
- 친구가 import 가능한 private `.mrpack`을 Modrinth App으로 가져온다.
- 친구 client connection mod가 invite/session 정보를 사용해 로컬 loopback target을 연다.
- 배포 또는 운영 형태의 relay path가 승인된 session만 host room으로 forwarding한다.
- 호스트가 server-observed Minecraft UUID 기반 approval을 처리한다.
- 친구가 relay를 통해 실제 host local room에 접속한다.
- expired, revoked, wrong-room, wrong-UUID, replay, arbitrary TCP 시도가 실패한다.
- 비개발자 host/friend 테스트에서 서버, 포트포워딩, VPN, 방화벽 설명 없이 흐름이 완료된다.
- closed-alpha release checklist와 support redaction, noindex, accessibility 확인이 통과한다.

현재 프리뷰는 이 완료 조건을 향해 가는 개발자용 실행 점검이며, MVP-0 제품 완성품이 아니다. 이번 단계에서 Java 감지, Fabric server jar checksum bootstrap, local process lifecycle adapter는 구현됐지만, 실제 Windows GUI 버튼에서 real Fabric 서버를 시작하는 수동 검증은 아직 남아 있다.

## 관련 문서

- [MVP-0 Runnable Preview Implementation Plan](../plans/2026-04-30-001-feature-mvp0-runnable-preview-plan.md)
- [M3 Real Runtime Bootstrap Plan](../plans/2026-04-30-002-feature-m3-real-runtime-bootstrap-plan.md)
- [Desktop Runtime Bridge Implementation Plan](../plans/2026-04-30-003-feature-desktop-runtime-bridge-plan.md)
- [프로젝트 상태 및 다음 계획 보고서](../reports/2026-04-30-project-status-and-next-plan-report.md)
- [M3 Host App Local Room Runtime TODO](../todos/M3-host-app-local-room-runtime.md)
- [M4 Relay Join End-To-End TODO](../todos/M4-relay-join-end-to-end.md)
