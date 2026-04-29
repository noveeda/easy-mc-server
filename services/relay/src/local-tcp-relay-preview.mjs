import { createConnection, createServer } from "node:net";

export const LocalTcpRelayPreviewFailureReasons = Object.freeze({
  SESSION_UNAVAILABLE: "session_unavailable",
  SESSION_BINDING_MISMATCH: "session_binding_mismatch",
  OPEN_PROXY_BLOCKED: "open_proxy_blocked",
  BAD_OPEN_FRAME: "bad_open_frame",
  OPEN_FRAME_TOO_LARGE: "open_frame_too_large"
});

export async function startLocalTcpRelayPreview(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const maxOpenFrameBytes = options.maxOpenFrameBytes ?? 8192;
  const sessions = new Map((options.sessions ?? []).map((session) => [session.sessionId, session]));
  const openedStreams = [];

  const server = createServer((friendSocket) => {
    let initialBuffer = Buffer.alloc(0);

    friendSocket.on("data", function onInitialData(chunk) {
      initialBuffer = Buffer.concat([initialBuffer, chunk]);
      const newlineIndex = initialBuffer.indexOf(10);

      if ((newlineIndex === -1 && initialBuffer.byteLength > maxOpenFrameBytes) || newlineIndex > maxOpenFrameBytes) {
        friendSocket.off("data", onInitialData);
        rejectFriend(friendSocket, LocalTcpRelayPreviewFailureReasons.OPEN_FRAME_TOO_LARGE);
        return;
      }

      if (newlineIndex === -1) {
        return;
      }

      friendSocket.off("data", onInitialData);

      const frameText = initialBuffer.subarray(0, newlineIndex).toString("utf8");
      const remainder = initialBuffer.subarray(newlineIndex + 1);
      const frame = parseOpenFrame(frameText);
      if (!frame.ok) {
        rejectFriend(friendSocket, LocalTcpRelayPreviewFailureReasons.BAD_OPEN_FRAME);
        return;
      }

      const session = sessions.get(frame.openFrame.sessionId);
      if (!session) {
        rejectFriend(friendSocket, LocalTcpRelayPreviewFailureReasons.SESSION_UNAVAILABLE);
        return;
      }

      if (!sessionBindingMatches(frame.openFrame, session)) {
        rejectFriend(friendSocket, LocalTcpRelayPreviewFailureReasons.SESSION_BINDING_MISMATCH);
        return;
      }

      if (isArbitraryTarget(frame.openFrame.requestedTarget, session.target)) {
        rejectFriend(friendSocket, LocalTcpRelayPreviewFailureReasons.OPEN_PROXY_BLOCKED);
        return;
      }

      const hostSocket = createConnection({
        host: session.target.host,
        port: session.target.port
      });

      openedStreams.push({
        sessionId: session.sessionId,
        roomId: session.roomId,
        minecraftUuid: session.minecraftUuid,
        target: { ...session.target }
      });

      hostSocket.on("connect", () => {
        if (remainder.byteLength > 0) {
          hostSocket.write(remainder);
        }
        friendSocket.pipe(hostSocket);
        hostSocket.pipe(friendSocket);
      });

      hostSocket.on("error", () => {
        friendSocket.destroy();
      });

      friendSocket.on("error", () => {
        hostSocket.destroy();
      });

      friendSocket.on("close", () => {
        hostSocket.destroy();
      });
    });
  });

  await listen(server, host, port);

  return {
    host,
    port: server.address().port,
    openedStreams,
    close: () => closeServer(server)
  };
}

export async function startTcpEchoTarget(options = {}) {
  const received = [];
  const server = createServer((socket) => {
    socket.on("data", (chunk) => {
      received.push(chunk.toString("utf8"));
      socket.write(Buffer.concat([Buffer.from(options.responsePrefix ?? ""), chunk]));
    });
  });

  await listen(server, options.host ?? "127.0.0.1", options.port ?? 0);

  return {
    host: options.host ?? "127.0.0.1",
    port: server.address().port,
    received,
    close: () => closeServer(server)
  };
}

export function createFriendOpenFrame(input = {}) {
  return `${JSON.stringify({
    protocolVersion: "relay.m4",
    kind: "friend_stream_open",
    roomId: input.roomId,
    sessionId: input.sessionId,
    minecraftUuid: input.minecraftUuid,
    requestedTarget: input.requestedTarget
  })}\n`;
}

function parseOpenFrame(frameText) {
  try {
    const openFrame = JSON.parse(frameText);
    if (
      openFrame.protocolVersion !== "relay.m4"
      || openFrame.kind !== "friend_stream_open"
      || !openFrame.roomId
      || !openFrame.sessionId
      || !openFrame.minecraftUuid
    ) {
      return { ok: false };
    }
    return { ok: true, openFrame };
  } catch {
    return { ok: false };
  }
}

function sessionBindingMatches(openFrame, session) {
  return session.roomId === openFrame.roomId && session.minecraftUuid === openFrame.minecraftUuid;
}

function isArbitraryTarget(requestedTarget, allowedTarget) {
  if (!requestedTarget) {
    return false;
  }

  return requestedTarget.host !== allowedTarget.host || requestedTarget.port !== allowedTarget.port;
}

function rejectFriend(socket, reason) {
  socket.end(`${JSON.stringify({ ok: false, reason })}\n`);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
