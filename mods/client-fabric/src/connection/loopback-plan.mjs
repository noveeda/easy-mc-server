export const LoopbackFailureReasons = Object.freeze({
  SESSION_MISSING: "session_missing",
  RELAY_URL_MISSING: "relay_url_missing",
  ROOM_MISSING: "room_missing"
});

const redactionLabels = Object.freeze({
  inviteToken: "invite_token",
  sessionToken: "session_token",
  relayToken: "relay_token"
});

export function createClientLoopbackPlan(input = {}) {
  if (!input.roomId || !input.minecraftUuid) {
    return fail(LoopbackFailureReasons.ROOM_MISSING);
  }

  if (!input.relayUrl) {
    return fail(LoopbackFailureReasons.RELAY_URL_MISSING);
  }

  if (!input.sessionId || !input.sessionToken) {
    return fail(LoopbackFailureReasons.SESSION_MISSING);
  }

  const localPort = input.localPort ?? 25565;
  const diagnostics = redactLoopbackDiagnostics(
    {
      roomId: input.roomId,
      minecraftUuid: input.minecraftUuid,
      inviteUrl: input.inviteUrl,
      relayUrl: input.relayUrl,
      localServerAddress: `127.0.0.1:${localPort}`,
      events: [
        `invite=${input.inviteToken ?? "none"}`,
        `session=${input.sessionToken}`,
        `relay=${input.relayToken ?? "none"}`
      ]
    },
    input
  );

  return {
    ok: true,
    connection: {
      minecraftServerAddress: `127.0.0.1:${localPort}`,
      localProxy: {
        host: "127.0.0.1",
        port: localPort
      },
      relay: {
        url: redactUrlSecret(input.relayUrl, input),
        roomId: input.roomId,
        sessionId: input.sessionId,
        minecraftUuid: input.minecraftUuid
      }
    },
    diagnostics
  };
}

export function redactLoopbackDiagnostics(value, secrets = {}) {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLoopbackDiagnostics(item, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, redactLoopbackDiagnostics(nested, secrets)])
    );
  }

  return value;
}

function redactUrlSecret(url, secrets) {
  return redactString(url, {
    sessionToken: secrets.sessionToken,
    relayToken: secrets.relayToken
  });
}

function redactString(value, secrets) {
  let redacted = value;

  for (const [key, label] of Object.entries(redactionLabels)) {
    const secret = secrets[key];

    if (secret) {
      redacted = redacted.replaceAll(secret, `[redacted:${label}]`);
    }
  }

  return redacted;
}

function fail(reason) {
  return {
    ok: false,
    reason
  };
}
