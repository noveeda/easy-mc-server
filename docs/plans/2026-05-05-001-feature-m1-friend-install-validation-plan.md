---
status: active
created: 2026-05-05
type: feature
scope: m1-friend-install-validation
---

# M1 친구 설치와 참가 흐름 검증 계획

## Problem Frame

M1의 목표는 친구가 초대 링크에서 필요한 모드팩을 적용하고 Minecraft 승인 대기 상태까지 도달하는 흐름을 검증 가능한 제품 경로로 만드는 것이다. 현재 control plane, desktop runtime, relay/session 계약은 상당 부분 준비되어 있으나, M1의 실제 blocker는 first-party client/server mod artifact와 placeholder 없는 private `.mrpack` 생성 경로다.

이 계획은 MVP-0 전체를 확장하지 않고 M1 완료에 필요한 artifact/pack/install 검증 경로만 다룬다.

---

## Requirements

- R1. first-party client/server mod artifact는 실제 jar bytes에서 SHA1, SHA512, file size를 계산할 수 있어야 한다.
- R2. `.mrpack` 템플릿은 signed HTTPS artifact URL과 pinned hashes가 명시적으로 주입될 때만 import 가능한 manifest로 열린다.
- R3. example.invalid, REPLACE_WITH, fileSize 0 같은 placeholder는 계속 fail-closed 처리한다.
- R4. 친구용 화면이나 문서에서 더미 URL, 로컬 파일 경로, 개발용 artifact를 실제 성공 상태처럼 보여주지 않는다.
- R5. M1 자동 검증은 artifact lock, `.mrpack` manifest 생성, unsafe metadata rejection을 테스트한다.
- R6. 실제 Modrinth App import는 signed HTTPS artifact 게시 이후 수동 검증으로 남긴다.

---

## Scope Boundaries

- 포함: first-party artifact build 후보, artifact lock 계산, `.mrpack` 생성 helper/CLI, M1 검증 문서화.
- 제외: production installer, Direct P2P, 범용 모드 호환성 엔진, CurseForge/Prism 확장.
- 제외: 실제 public HTTPS artifact hosting과 서명 인프라. 단, 그 입력을 받아 `.mrpack`을 만들 수 있는 계약은 포함한다.

---

## Context & Research

### Relevant Code and Patterns

- `packages/modpack-builder/src/mrpack.mjs`
- `packages/modpack-builder/tests/mrpack.test.mjs`
- `packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json`
- `mods/client-fabric/src/main/resources/fabric.mod.json`
- `mods/server-bridge-fabric/src/main/resources/fabric.mod.json`
- `mods/client-fabric/src/main/java/com/easymc/room/client/LocalRoomClientMod.java`
- `mods/server-bridge-fabric/src/main/java/com/easymc/room/server/LocalRoomServerBridgeMod.java`

### Notion References

- `마일스톤과 개발 게이트`
- `모드팩과 모드 정책`
- `사용법과 검증 가이드`
- `first-party client/server mod artifact 준비`
- `import 가능한 private .mrpack 생성과 Modrinth import 검증`

---

## Key Technical Decisions

- `.mrpack` 템플릿에는 fake URL을 저장하지 않는다. 실제 artifact metadata는 별도 lock 입력으로 주입한다.
- first-party artifact lock은 jar bytes에서 계산한다. 수동 입력한 hash가 jar와 불일치하는 경로를 만들지 않는다.
- 로컬 개발 artifact는 import 가능한 친구용 pack으로 표시하지 않는다. 친구용 pack은 HTTPS URL lock이 있어야 한다.
- Java skeleton jar 생성은 Gradle/Loom 도입 전까지 javac/jar 기반 최소 빌드로 검증한다.

---

## Implementation Units

- U1. **First-Party Artifact Build Candidate**

**Goal:** `mods/client-fabric`와 `mods/server-bridge-fabric`의 현재 skeleton을 jar artifact로 만들 수 있는 최소 로컬 빌드 경로를 만든다.

**Requirements:** R1, R4

**Dependencies:** None

**Files:**
- Modify: `mods/client-fabric/README.md`
- Modify: `mods/server-bridge-fabric/README.md`
- Create or Modify: `scripts/*artifact*.mjs`
- Test: `mods/client-fabric/tests/loopback-plan.test.mjs`
- Test: `mods/server-bridge-fabric/tests/server-bridge.test.mjs`

**Approach:**
- 외부 네트워크 없이 Java 21 `javac`와 `jar`로 skeleton jar를 만든다.
- jar 안에는 compiled class와 `fabric.mod.json`을 포함한다.
- 생성물은 로컬 검증 artifact이며 signed/public release가 아님을 문서화한다.

**Test scenarios:**
- Happy path: client/server skeleton jar가 생성되고 fabric metadata가 포함된다.
- Error path: Java compiler 또는 jar tool이 없으면 명확한 실패를 반환한다.
- Edge case: 소스 파일 누락 시 부분 jar를 만들지 않는다.

**Verification:**
- 관련 mod tests가 통과한다.
- 생성 script가 로컬 artifact 위치와 lock 계산에 필요한 bytes를 제공한다.

---

- U2. **Private Mrpack Generation Contract**

**Goal:** signed HTTPS artifact URL과 jar bytes가 있을 때 placeholder 없는 `.mrpack`을 생성할 수 있는 helper 또는 CLI를 만든다.

**Requirements:** R2, R3, R5

**Dependencies:** U1 artifact bytes contract

**Files:**
- Modify: `packages/modpack-builder/src/mrpack.mjs`
- Modify: `packages/modpack-builder/tests/mrpack.test.mjs`
- Create or Modify: `scripts/*mrpack*.mjs`
- Modify: `packages/modpack-builder/m1/README.md`

**Approach:**
- `createFirstPartyArtifactLock`과 `applyFirstPartyArtifactLocks`를 사용한다.
- HTTPS URL, SHA1, SHA512, file size가 완성된 경우에만 manifest build/write를 허용한다.
- unsafe metadata와 placeholder는 기존 fail-closed 정책을 유지한다.

**Test scenarios:**
- Happy path: signed HTTPS URL과 jar bytes가 있으면 placeholder 없는 manifest가 생성된다.
- Error path: HTTP URL은 거절된다.
- Error path: first-party lock 없이 placeholder를 제거한 템플릿은 승인되지 않는다.
- Edge case: 알 수 없는 first-party path는 approved lock으로 인정하지 않는다.

**Verification:**
- `packages/modpack-builder/tests/mrpack.test.mjs`가 통과한다.
- 전체 테스트에서 static prototype check가 통과한다.

---

- U3. **M1 Validation Guide Update**

**Goal:** M1에서 자동으로 완료 가능한 것과 실제 Modrinth App 수동 검증이 필요한 것을 구분한다.

**Requirements:** R4, R6

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/modpack-builder/m1/README.md`
- Modify: `docs/usage/mvp0-local-preview.md` if still retained
- Notion: `import 가능한 private .mrpack 생성과 Modrinth import 검증`
- Notion: `first-party client/server mod artifact 준비`

**Approach:**
- 개발용 artifact와 친구용 signed HTTPS artifact를 분리해 설명한다.
- MVP-0 완료 판단에 필요한 수동 검증을 명시한다.

**Test scenarios:**
- Test expectation: none for Notion-only documentation. Local Markdown changes must pass `git diff --check`.

**Verification:**
- 문서가 더미 URL을 성공 경로로 말하지 않는다.
- Notion 칸반의 다음 행동이 실제 남은 blocker를 가리킨다.

---

## System-Wide Impact

- **Interaction graph:** mod skeleton artifact → artifact lock → `.mrpack` manifest → invite page download/import flow.
- **Error propagation:** artifact metadata 누락은 `.mrpack` 생성 실패로 남아야 하며 UI 성공 상태로 전파되면 안 된다.
- **State lifecycle risks:** generated local artifacts와 public release artifacts를 혼동하면 친구에게 사용할 수 없는 pack을 배포할 수 있다.
- **API surface parity:** modpack-builder helper와 script는 같은 validation rules를 사용해야 한다.
- **Integration coverage:** 실제 Modrinth App import는 자동 테스트가 대체할 수 없으므로 수동 검증으로 남긴다.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 개발용 jar를 친구용 artifact처럼 오해 | docs와 CLI 출력에서 local/dev artifact라고 명시 |
| fake HTTPS URL로 `.mrpack` 통과 | caller-supplied lock과 HTTPS validation, tests로 방지 |
| 실제 Fabric/Loom mod가 아닌 skeleton jar를 과신 | M1 검증 artifact와 production artifact를 분리 |
| Modrinth import 수동 검증 누락 | Notion 칸반에 별도 검증 작업 유지 |

---

## Documentation / Operational Notes

- Notion이 제품 문서의 기준이다.
- 이 plan file은 LFG 실행을 위한 작업 계획이며, 최종 진행 상태는 Notion 칸반에 반영한다.
- 커밋/푸시는 사용자가 명시적으로 요청할 때만 수행한다.
