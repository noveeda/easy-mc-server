import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  BridgeDecisionTypes,
  BridgeJoinStates,
  ControlPlaneOutagePolicies,
  createServerBridgeState,
  serializeMinecraftWhitelist
} from "../src/server-bridge.mjs";

test("Fabric server bridge skeleton declares supported mod metadata", () => {
  assert.equal(existsSync("mods/server-bridge-fabric/src/main/java/com/easymc/room/server/LocalRoomServerBridgeMod.java"), true);

  const metadata = JSON.parse(readFileSync("mods/server-bridge-fabric/src/main/resources/fabric.mod.json", "utf8"));
  assert.deepEqual(
    {
      id: metadata.id,
      environment: metadata.environment,
      minecraft: metadata.depends.minecraft,
      fabricloader: metadata.depends.fabricloader,
      entrypoint: metadata.entrypoints.server[0]
    },
    {
      id: "easy_mc_room_server_bridge",
      environment: "server",
      minecraft: "1.21.1",
      fabricloader: ">=0.16.10",
      entrypoint: "com.easymc.room.server.LocalRoomServerBridgeMod"
    }
  );
});

test("server bridge creates pending approval from server-observed UUID", () => {
  const bridge = createServerBridgeState({
    roomId: "room-a",
    allowlistPath: "C:/RoomBuilder/rooms/room-a/whitelist.json"
  });

  const result = bridge.observePlayerJoin({
    connectionId: "conn-a",
    displayName: "MineFriend_27",
    claimedIdentity: {
      friendId: "friend-a",
      minecraftUuid: "claimed-uuid"
    },
    serverObservedUuid: "server-observed-uuid"
  });

  assert.equal(result.state, BridgeJoinStates.PENDING_APPROVAL);
  assert.equal(result.allowed, false);
  assert.equal(result.kickMessage, "호스트가 승인하면 다시 들어올 수 있습니다.");
  assert.deepEqual(result.event, {
    type: "bridge.approval_requested",
    roomId: "room-a",
    connectionId: "conn-a",
    friendId: "friend-a",
    displayName: "MineFriend_27",
    minecraftUuid: "server-observed-uuid",
    claimedMinecraftUuid: "claimed-uuid",
    requiresHostApproval: true,
    identityMismatch: true
  });
});

test("approval decision persists approved UUIDs to the Minecraft whitelist", () => {
  const bridge = createServerBridgeState({
    roomId: "room-a",
    allowlistPath: "C:/RoomBuilder/rooms/room-a/whitelist.json"
  });

  bridge.observePlayerJoin({
    connectionId: "conn-a",
    displayName: "MineFriend_27",
    serverObservedUuid: "uuid-a"
  });
  const result = bridge.applyApprovalDecision({
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27",
    decision: BridgeDecisionTypes.APPROVED
  });

  assert.equal(result.state, BridgeJoinStates.ALLOWED);
  assert.deepEqual(bridge.readAllowlist(), [
    {
      uuid: "uuid-a",
      name: "MineFriend_27"
    }
  ]);
  assert.deepEqual(result.persistence, {
    path: "C:/RoomBuilder/rooms/room-a/whitelist.json",
    kind: "minecraft-whitelist",
    contents: "[\n  {\n    \"uuid\": \"uuid-a\",\n    \"name\": \"MineFriend_27\"\n  }\n]\n"
  });
});

test("denied and blocked decisions return clear in-game messages", () => {
  const bridge = createServerBridgeState({ roomId: "room-a" });

  bridge.observePlayerJoin({
    connectionId: "conn-a",
    displayName: "DeniedFriend",
    serverObservedUuid: "uuid-a"
  });
  assert.deepEqual(bridge.applyApprovalDecision({ minecraftUuid: "uuid-a", decision: BridgeDecisionTypes.DENIED }), {
    state: BridgeJoinStates.DENIED,
    allowed: false,
    minecraftUuid: "uuid-a",
    kickMessage: "호스트가 요청을 거절했습니다. 다시 초대받은 뒤 시도해 주세요."
  });

  bridge.observePlayerJoin({
    connectionId: "conn-b",
    displayName: "BlockedFriend",
    serverObservedUuid: "uuid-b"
  });
  const blocked = bridge.applyApprovalDecision({
    minecraftUuid: "uuid-b",
    displayName: "BlockedFriend",
    decision: BridgeDecisionTypes.BLOCKED
  });

  assert.equal(blocked.state, BridgeJoinStates.BLOCKED);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.kickMessage, "이 방에 들어올 수 없습니다.");
  assert.deepEqual(bridge.canPlayerJoin({ minecraftUuid: "uuid-b" }), {
    allowed: false,
    state: BridgeJoinStates.BLOCKED,
    kickMessage: "이 방에 들어올 수 없습니다."
  });
});

test("approval decisions fail closed without a pending server-observed request", () => {
  const bridge = createServerBridgeState({ roomId: "room-a" });

  assert.deepEqual(
    bridge.applyApprovalDecision({
      minecraftUuid: "uuid-a",
      displayName: "MineFriend_27",
      decision: BridgeDecisionTypes.APPROVED
    }),
    {
      ok: false,
      failure: {
        reason: "approval_request_missing",
        message: "대기 중인 승인 요청이 없습니다."
      }
    }
  );
  assert.deepEqual(bridge.readAllowlist(), []);
});

test("unsupported approval decisions fail without clearing pending requests", () => {
  const bridge = createServerBridgeState({ roomId: "room-a" });

  bridge.observePlayerJoin({
    connectionId: "conn-a",
    displayName: "MineFriend_27",
    serverObservedUuid: "uuid-a"
  });

  assert.deepEqual(bridge.applyApprovalDecision({ minecraftUuid: "uuid-a", decision: "maybe" }), {
    ok: false,
    failure: {
      reason: "unsupported_decision",
      message: "지원하지 않는 승인 결정입니다."
    }
  });
  assert.deepEqual(bridge.canPlayerJoin({ minecraftUuid: "uuid-a" }), {
    allowed: false,
    state: BridgeJoinStates.PENDING_APPROVAL,
    kickMessage: "호스트가 승인하면 다시 들어올 수 있습니다."
  });
});

test("previously approved players can join during a temporary control-plane outage", () => {
  const bridge = createServerBridgeState({
    roomId: "room-a",
    allowlist: [
      {
        uuid: "approved-uuid",
        name: "MineFriend_27"
      }
    ],
    outagePolicy: ControlPlaneOutagePolicies.ALLOW_PREVIOUSLY_APPROVED
  });

  bridge.setControlPlaneOnline(false);

  assert.deepEqual(bridge.canPlayerJoin({ minecraftUuid: "approved-uuid" }), {
    allowed: true,
    state: BridgeJoinStates.ALLOWED,
    outageMode: true
  });
  assert.deepEqual(bridge.canPlayerJoin({ minecraftUuid: "new-uuid" }), {
    allowed: false,
    state: BridgeJoinStates.DENIED,
    kickMessage: "방 승인 상태를 확인할 수 없어 잠시 후 다시 시도해 주세요."
  });
});

test("join observer enforces outage policy for approved and new players", () => {
  const denyAllBridge = createServerBridgeState({
    roomId: "room-a",
    allowlist: [
      {
        uuid: "approved-uuid",
        name: "MineFriend_27"
      }
    ],
    outagePolicy: ControlPlaneOutagePolicies.DENY_ALL,
    controlPlaneOnline: false
  });

  assert.deepEqual(denyAllBridge.observePlayerJoin({ serverObservedUuid: "approved-uuid" }), {
    state: BridgeJoinStates.DENIED,
    allowed: false,
    minecraftUuid: "approved-uuid",
    kickMessage: "방 승인 상태를 확인할 수 없어 잠시 후 다시 시도해 주세요."
  });

  const defaultBridge = createServerBridgeState({
    roomId: "room-a",
    controlPlaneOnline: false
  });

  assert.deepEqual(defaultBridge.observePlayerJoin({ serverObservedUuid: "new-uuid" }), {
    state: BridgeJoinStates.DENIED,
    allowed: false,
    minecraftUuid: "new-uuid",
    kickMessage: "방 승인 상태를 확인할 수 없어 잠시 후 다시 시도해 주세요."
  });
});

test("bridge health reports pending, allowlist, block, and last event state", () => {
  const bridge = createServerBridgeState({
    roomId: "room-a",
    allowlist: [{ uuid: "uuid-a", name: "MineFriend_27" }],
    blocked: [{ uuid: "uuid-b", name: "BlockedFriend" }]
  });

  bridge.observePlayerJoin({
    connectionId: "conn-c",
    displayName: "PendingFriend",
    serverObservedUuid: "uuid-c"
  });

  assert.deepEqual(bridge.readHealth(), {
    type: "bridge.health",
    roomId: "room-a",
    status: "healthy",
    controlPlaneOnline: true,
    outagePolicy: ControlPlaneOutagePolicies.ALLOW_PREVIOUSLY_APPROVED,
    pendingCount: 1,
    allowedCount: 1,
    blockedCount: 1,
    lastEventType: "bridge.approval_requested"
  });
});

test("Minecraft whitelist serialization is stable", () => {
  assert.equal(
    serializeMinecraftWhitelist([{ uuid: "uuid-a", name: "MineFriend_27" }]),
    "[\n  {\n    \"uuid\": \"uuid-a\",\n    \"name\": \"MineFriend_27\"\n  }\n]\n"
  );
});
