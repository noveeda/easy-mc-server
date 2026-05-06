export const DesktopRuntimeCommands = Object.freeze({
  PREPARE_ROOM: "desktop_prepare_room",
  OPEN_ROOM: "desktop_open_room",
  CLOSE_ROOM: "desktop_close_room",
  RESTART_ROOM: "desktop_restart_room",
  SEND_SERVER_COMMAND: "desktop_send_server_command",
  STATUS_ROOM: "desktop_status_room",
  RESET_ROOM: "desktop_reset_room"
});

const commandRoutes = Object.freeze({
  [DesktopRuntimeCommands.PREPARE_ROOM]: ["prepareRoom"],
  [DesktopRuntimeCommands.OPEN_ROOM]: ["openRoom"],
  [DesktopRuntimeCommands.CLOSE_ROOM]: ["closeRoom"],
  [DesktopRuntimeCommands.RESTART_ROOM]: ["restartRoom"],
  [DesktopRuntimeCommands.SEND_SERVER_COMMAND]: ["sendServerCommand"],
  [DesktopRuntimeCommands.STATUS_ROOM]: ["statusRoom", "status"],
  [DesktopRuntimeCommands.RESET_ROOM]: ["resetRoom"]
});

const commandSchemas = Object.freeze({
  [DesktopRuntimeCommands.PREPARE_ROOM]: Object.freeze({
    minecraftVersion: validateVersionString,
    pack: validateIdentifierString,
    catalogModId: validateIdentifierString
  }),
  [DesktopRuntimeCommands.OPEN_ROOM]: Object.freeze({
    minecraftVersion: validateVersionString,
    pack: validateIdentifierString,
    catalogModId: validateIdentifierString
  }),
  [DesktopRuntimeCommands.CLOSE_ROOM]: Object.freeze({}),
  [DesktopRuntimeCommands.RESTART_ROOM]: Object.freeze({
    minecraftVersion: validateVersionString,
    pack: validateIdentifierString,
    catalogModId: validateIdentifierString
  }),
  [DesktopRuntimeCommands.SEND_SERVER_COMMAND]: Object.freeze({
    command: validateConsoleCommand
  }),
  [DesktopRuntimeCommands.STATUS_ROOM]: Object.freeze({}),
  [DesktopRuntimeCommands.RESET_ROOM]: Object.freeze({})
});

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);
const privateEgressKeyPattern = /inviteLink|inviteUrl|inviteToken|rawInvite|token|secret|password|credential|authorization|cookie|session|email|uuid|path/i;

export function createDesktopCommandHost(controller, options = {}) {
  const fallbackIdleDto = options.idleDto ?? {
    state: "idle",
    summary: "Room command host is idle."
  };

  async function invoke(command, payload = {}) {
    const route = commandRoutes[command];

    if (!route) {
      return blockedDto("unknown_command", "Unknown desktop command.");
    }

    const requestResult = sanitizeRendererRequest(command, payload?.request ?? {});
    if (!requestResult.ok) {
      return blockedDto("invalid_request", requestResult.message);
    }
    const request = requestResult.request;

    if (command === DesktopRuntimeCommands.RESET_ROOM && typeof controller?.resetRoom !== "function") {
      return cloneDto(fallbackIdleDto);
    }

    const methodName = route.find((candidate) => typeof controller?.[candidate] === "function");
    if (!methodName) {
      return blockedDto("command_unavailable", `Desktop command is unavailable: ${command}`);
    }

    const result = await controller[methodName](request);
    return sanitizeCommandResult(result);
  }

  return {
    commands: DesktopRuntimeCommands,
    invoke
  };
}

function sanitizeRendererRequest(command, request) {
  if (!isPlainRequestObject(request)) {
    return {
      ok: false,
      message: "Desktop command request must be an object."
    };
  }

  const schema = commandSchemas[command] ?? {};
  const entries = Object.entries(request);
  const unknown = entries.find(([key]) => !isSupportedRequestField(schema, key));

  if (unknown) {
    return {
      ok: false,
      message: "Desktop command request contains unsupported fields."
    };
  }

  const invalid = entries.find(([key, value]) => !isValidRequestEntry(schema, key, value));
  if (invalid) {
    return {
      ok: false,
      message: "Desktop command request contains invalid values."
    };
  }

  return {
    ok: true,
    request: Object.fromEntries(entries)
  };
}

function isSupportedRequestField(schema, key) {
  return Object.hasOwn(schema, key);
}

function isValidRequestEntry(schema, key, value) {
  return schema[key](value);
}

function blockedDto(reason, message) {
  return {
    state: "blocked",
    failure: {
      reason,
      message
    }
  };
}

function cloneDto(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainRequestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return !Object.keys(value).some((key) => dangerousKeys.has(key));
}

function validateVersionString(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32
    && /^[0-9][0-9A-Za-z.+_-]*$/.test(value);
}

function validateIdentifierString(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 64
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function validateConsoleCommand(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= 256
    && !/[\r\n]/.test(value)
    && !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value);
}

function sanitizeCommandResult(value, key = "", depth = 0) {
  if (typeof value === "string") {
    if (isTopLevelInviteLink(key, depth)) {
      return value;
    }
    return redactSecretString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCommandResult(entry, "", depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => isTopLevelInviteLink(entryKey, depth + 1) || !isPrivateEgressKey(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, sanitizeCommandResult(entryValue, entryKey, depth + 1)])
    );
  }

  return value;
}

function isTopLevelInviteLink(key, depth) {
  return key === "inviteLink" && depth === 1;
}

function isPrivateEgressKey(key) {
  return privateEgressKeyPattern.test(key);
}

function redactSecretString(value) {
  const text = String(value);
  if (/^[A-Za-z]:[\\/]/.test(text)) {
    return "[redacted-path]";
  }

  return text
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[redacted]")
    .replace(/\[(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{0,}\](?::\d{1,5})?/gi, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[redacted-path]")
    .replace(/(^|\s)\/(?:Users|home|var|tmp|opt)\/[^\s"'<>]+/g, "$1[redacted-path]")
    .replace(/\b(invite|inviteToken|token|secret|password|credential|authorization|cookie)=([^&\s"'<>]+)/gi, "$1=[redacted]")
    .replace(/\b(Bearer|Basic)\s+[^&\s"'<>]+/gi, "$1 [redacted]")
    .replace(/\b([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi, "[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]");
}
