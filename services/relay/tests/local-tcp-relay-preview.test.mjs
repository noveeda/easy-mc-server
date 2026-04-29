import { once } from "node:events";
import { createConnection } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalTcpRelayPreviewFailureReasons,
  createFriendOpenFrame,
  startLocalTcpRelayPreview,
  startTcpEchoTarget
} from "../src/local-tcp-relay-preview.mjs";

test("local TCP relay preview forwards friend bytes to the fixed host target", async () => {
  const hostTarget = await startTcpEchoTarget({ responsePrefix: "host:" });
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const socket = createConnection({ host: relay.host, port: relay.port });
    await once(socket, "connect");
    socket.write(createFriendOpenFrame({
      roomId: "room-a",
      sessionId: "session-a",
      minecraftUuid: "uuid-a",
      requestedTarget: {
        host: hostTarget.host,
        port: hostTarget.port
      }
    }));
    socket.write("ping");

    const [response] = await once(socket, "data");
    socket.destroy();

    assert.equal(response.toString("utf8"), "host:ping");
    assert.deepEqual(hostTarget.received, ["ping"]);
    assert.deepEqual(relay.openedStreams, [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]);
  } finally {
    await relay.close();
    await hostTarget.close();
  }
});

test("local TCP relay preview rejects unknown sessions", async () => {
  const hostTarget = await startTcpEchoTarget();
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const response = await sendOpenFrame(relay, createFriendOpenFrame({
      roomId: "room-a",
      sessionId: "missing-session",
      minecraftUuid: "uuid-a"
    }));

    assert.deepEqual(JSON.parse(response), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.SESSION_UNAVAILABLE
    });
    assert.deepEqual(hostTarget.received, []);
  } finally {
    await relay.close();
    await hostTarget.close();
  }
});

test("local TCP relay preview blocks friend-selected arbitrary targets", async () => {
  const hostTarget = await startTcpEchoTarget();
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const response = await sendOpenFrame(relay, createFriendOpenFrame({
      roomId: "room-a",
      sessionId: "session-a",
      minecraftUuid: "uuid-a",
      requestedTarget: {
        host: "127.0.0.1",
        port: 22
      }
    }));

    assert.deepEqual(JSON.parse(response), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.OPEN_PROXY_BLOCKED
    });
    assert.deepEqual(hostTarget.received, []);
  } finally {
    await relay.close();
    await hostTarget.close();
  }
});

test("local TCP relay preview rejects session binding mismatches", async () => {
  const hostTarget = await startTcpEchoTarget();
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const wrongRoom = await sendOpenFrame(relay, createFriendOpenFrame({
      roomId: "room-b",
      sessionId: "session-a",
      minecraftUuid: "uuid-a"
    }));
    const wrongUuid = await sendOpenFrame(relay, createFriendOpenFrame({
      roomId: "room-a",
      sessionId: "session-a",
      minecraftUuid: "uuid-b"
    }));

    assert.deepEqual(JSON.parse(wrongRoom), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.SESSION_BINDING_MISMATCH
    });
    assert.deepEqual(JSON.parse(wrongUuid), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.SESSION_BINDING_MISMATCH
    });
    assert.deepEqual(hostTarget.received, []);
  } finally {
    await relay.close();
    await hostTarget.close();
  }
});

test("local TCP relay preview rejects oversized open frames", async () => {
  const relay = await startLocalTcpRelayPreview({ maxOpenFrameBytes: 64 });

  try {
    const response = await sendOpenFrame(relay, "x".repeat(65));

    assert.deepEqual(JSON.parse(response), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.OPEN_FRAME_TOO_LARGE
    });
  } finally {
    await relay.close();
  }
});

test("local TCP relay preview rejects malformed open frames", async () => {
  const hostTarget = await startTcpEchoTarget();
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "session-a",
        roomId: "room-a",
        minecraftUuid: "uuid-a",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const response = await sendOpenFrame(relay, `${JSON.stringify({
      protocolVersion: "relay.m4",
      kind: "wrong_kind",
      sessionId: "session-a",
      roomId: "room-a",
      minecraftUuid: "uuid-a"
    })}\n`);

    assert.deepEqual(JSON.parse(response), {
      ok: false,
      reason: LocalTcpRelayPreviewFailureReasons.BAD_OPEN_FRAME
    });
    assert.deepEqual(hostTarget.received, []);
    assert.deepEqual(relay.openedStreams, []);
  } finally {
    await relay.close();
    await hostTarget.close();
  }
});

async function sendOpenFrame(relay, frame) {
  const socket = createConnection({ host: relay.host, port: relay.port });
  await once(socket, "connect");
  socket.write(frame);
  const [response] = await once(socket, "data");
  socket.destroy();
  return response.toString("utf8").trim();
}
