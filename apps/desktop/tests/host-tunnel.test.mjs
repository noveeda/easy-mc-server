import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostTunnelFailureReasons,
  HostTunnelUiStates,
  createHostTunnelPlan,
  createHostTunnelUiState,
  redactTunnelDiagnostics
} from "../src/tunnel/host-tunnel.mjs";
import { createRelayClock, createRelaySimulation } from "../../../services/relay/src/relay-simulation.mjs";

test("host tunnel plan binds the active room to the local Minecraft target", () => {
  const result = createHostTunnelPlan({
    roomId: "room-a",
    hostId: "host-a",
    relayUrl: "wss://relay.example.test/rooms/room-a?relayToken=relay-secret",
    relayToken: "relay-secret",
    hostTunnelToken: "host-token-a",
    localServerReady: true
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.localTarget, {
    kind: "minecraft",
    host: "127.0.0.1",
    port: 25565
  });
  assert.deepEqual(result.plan.relay.openFrame, {
    protocolVersion: "relay.m4",
    kind: "host_tunnel_open",
    roomId: "room-a",
    hostId: "host-a",
    hostToken: "host-token-a",
    target: {
      kind: "minecraft",
      host: "127.0.0.1",
      port: 25565
    }
  });
  assert.deepEqual(result.plan.lifecycle.closeOn, ["local_room_stopped", "local_room_crashed"]);
  assert.equal(JSON.stringify(result.plan.diagnostics).includes("host-token-a"), false);
  assert.equal(JSON.stringify(result.plan.diagnostics).includes("relay-secret"), false);
});

test("host tunnel plan fails closed before local room readiness and for arbitrary targets", () => {
  assert.deepEqual(createHostTunnelPlan({ roomId: "room-a", hostId: "host-a" }), {
    ok: false,
    failure: {
      reason: HostTunnelFailureReasons.ROOM_NOT_READY,
      message: "Open the room before letting friends join."
    }
  });

  assert.deepEqual(
    createHostTunnelPlan({
      roomId: "room-a",
      hostId: "host-a",
      relayUrl: "wss://relay.example.test/rooms/room-a",
      hostTunnelToken: "host-token-a",
      localServerReady: true,
      localTarget: {
        kind: "ssh",
        host: "127.0.0.1",
        port: 22
      }
    }),
    {
      ok: false,
      failure: {
        reason: HostTunnelFailureReasons.OPEN_PROXY_BLOCKED,
        message: "Use the local Minecraft room target."
      }
    }
  );
});

test("host tunnel UI states use room language for connection and quota states", () => {
  assert.deepEqual(createHostTunnelUiState({ status: "connecting" }), {
    state: HostTunnelUiStates.CONNECTING,
    title: "친구가 들어올 준비를 하는 중입니다.",
    primaryAction: null
  });
  assert.deepEqual(createHostTunnelUiState({ status: "open" }), {
    state: HostTunnelUiStates.READY,
    title: "친구가 들어올 준비가 됐습니다.",
    primaryAction: null
  });
  assert.deepEqual(createHostTunnelUiState({ status: "quota_warning" }), {
    state: HostTunnelUiStates.WARNING,
    title: "방 연결 사용량이 많습니다.",
    primaryAction: "keep_playing"
  });
  assert.deepEqual(createHostTunnelUiState({ status: "quota_stopped" }), {
    state: HostTunnelUiStates.STOPPED,
    title: "방 연결 제한에 도달했습니다.",
    primaryAction: "close_room"
  });
  assert.deepEqual(createHostTunnelUiState({ status: "disconnected" }), {
    state: HostTunnelUiStates.FAILED,
    title: "방 연결이 끊겼습니다.",
    primaryAction: "retry_connection"
  });
});

test("host tunnel diagnostic redaction removes nested tunnel secrets", () => {
  const redacted = redactTunnelDiagnostics(
    {
      url: "wss://relay.example.test?token=host-token-a",
      nested: {
        hostTunnelToken: "host-token-a"
      }
    },
    {
      hostTunnelToken: "host-token-a"
    }
  );

  assert.deepEqual(redacted, {
    url: "wss://relay.example.test?token=[redacted:tunnel_secret]",
    nested: {
      hostTunnelToken: "[redacted:tunnel_secret]"
    }
  });
});

test("host tunnel plan opens and closes the relay simulation for the active room", () => {
  const hostPlan = createHostTunnelPlan({
    roomId: "room-a",
    hostId: "host-a",
    relayUrl: "wss://relay.example.test/rooms/room-a",
    hostTunnelToken: "host-token-a",
    localServerReady: true
  });
  const relay = createRelaySimulation({
    clock: createRelayClock(0),
    hostCredentials: {
      "room-a:host-a": "host-token-a"
    }
  });

  const opened = relay.openHostTunnel({
    roomId: hostPlan.plan.roomId,
    hostId: hostPlan.plan.hostId,
    hostToken: hostPlan.plan.relay.openFrame.hostToken,
    target: hostPlan.plan.localTarget
  });

  assert.equal(opened.ok, true);
  relay.authorizeSession({
    sessionId: "session-a",
    sessionToken: "session-token-a",
    roomId: "room-a",
    inviteId: "invite-a",
    hostId: "host-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    approved: true,
    issuedAt: 0,
    expiresAt: 60_000
  });

  const stream = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.equal(stream.ok, true);

  const closed = relay.closeHostTunnel({
    tunnelId: opened.tunnel.id,
    hostToken: hostPlan.plan.lifecycle.closeFrame.hostToken,
    reason: "local_room_stopped"
  });

  assert.equal(closed.ok, true);
  assert.equal(closed.closedStreams, 1);
});
