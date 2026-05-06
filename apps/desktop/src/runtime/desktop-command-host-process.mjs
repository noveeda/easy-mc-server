import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { createControlPlaneBoundaryAdapter } from "./control-plane-boundary-adapter.mjs";
import { createDesktopCommandHost } from "./desktop-command-host.mjs";
import { createDesktopDevRuntimePlan } from "./desktop-dev-runtime-plan.mjs";
import { createDesktopRoomController } from "./desktop-room-controller.mjs";
import { createDesktopRuntimeBridge } from "./desktop-runtime-bridge.mjs";

const MAX_FRAME_BYTES = 16 * 1024;

if (isDirectExecution()) {
  runDesktopCommandHostProcess().catch((error) => {
    writeFrame({
      id: null,
      ok: false,
      result: blockedDto("host_process_failed", redactProcessErrorMessage(error?.message ?? "Desktop command host failed."))
    });
    process.exitCode = 1;
  });
}

export async function runDesktopCommandHostProcess(streams = {}) {
  const writer = streams.output ?? output;
  const commandHost = await createDesktopCommandHostForDevRuntime({
    ...(streams.options ?? {}),
    onRuntimeEvent(event) {
      writeEventFrame(event, writer);
    }
  });
  const reader = createInterface({
    input: streams.input ?? input,
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const result = await handleCommandFrame(commandHost, line);
    writeFrame(result, writer);
  }
}

export async function createDesktopCommandHostForDevRuntime(options = {}) {
  let runtimePlanOptions = normalizeRuntimePlanOptions(options.runtimePlanOptions);
  let runtimeSignature = runtimePlanSignature(runtimePlanOptions);
  let runtimePlan = await createDesktopDevRuntimePlan(runtimePlanOptions);
  let runtimeBridge = createDesktopRuntimeBridge(runtimePlan, runtimeBridgeOptions(options));
  let controlPlane = createControlPlane(options);
  let roomController = createRoomController(runtimePlan, runtimeBridge, controlPlane, options);

  const controller = {
    async prepareRoom(request) {
      const configured = await configureRuntimeForRequest(request);
      if (configured) {
        return configured;
      }
      return roomController.prepareRoom(request);
    },
    async openRoom(request) {
      const configured = await configureRuntimeForRequest(request);
      if (configured) {
        return configured;
      }
      return roomController.openRoom({
        ...request,
        downloadFabric: true,
        requireFabricDownload: true
      });
    },
    closeRoom(request) {
      return roomController.closeRoom(request);
    },
    async restartRoom(request) {
      const configured = await configureRuntimeForRequest(request);
      if (configured) {
        return configured;
      }
      return roomController.restartRoom({
        ...request,
        downloadFabric: true,
        requireFabricDownload: true
      });
    },
    sendServerCommand(request) {
      return runtimeBridge.sendServerCommand(request);
    },
    status() {
      return roomController.status();
    },
    statusRoom() {
      return roomController.statusRoom();
    },
    async resetRoom() {
      await roomController.closeRoom({ reason: "desktop_reset" });
      runtimePlanOptions = normalizeRuntimePlanOptions(options.runtimePlanOptions);
      runtimeSignature = runtimePlanSignature(runtimePlanOptions);
      runtimePlan = await createDesktopDevRuntimePlan(runtimePlanOptions);
      runtimeBridge = createDesktopRuntimeBridge(runtimePlan, runtimeBridgeOptions(options));
      controlPlane = createControlPlane(options);
      roomController = createRoomController(runtimePlan, runtimeBridge, controlPlane, options);
      return {
        state: "idle",
        summary: "Desktop command host was reset."
      };
    }
  };

  async function configureRuntimeForRequest(request = {}) {
    const nextOptions = normalizeRuntimePlanOptions({
      ...(options.runtimePlanOptions ?? {}),
      minecraftVersion: request.minecraftVersion,
      catalogModId: request.catalogModId
    });
    const nextSignature = runtimePlanSignature(nextOptions);
    if (nextSignature === runtimeSignature) {
      return null;
    }

    const state = runtimeBridge.status?.().state;
    if (["starting", "running", "stopping", "restarting"].includes(state)) {
      return blockedDto("runtime_reconfiguration_blocked", "Close the current room before changing the selected mods.");
    }

    runtimePlanOptions = nextOptions;
    runtimeSignature = nextSignature;
    runtimePlan = await createDesktopDevRuntimePlan(runtimePlanOptions);
    runtimeBridge = createDesktopRuntimeBridge(runtimePlan, runtimeBridgeOptions(options));
    controlPlane = createControlPlane(options);
    roomController = createRoomController(runtimePlan, runtimeBridge, controlPlane, options);
    return null;
  }

  return createDesktopCommandHost(controller);
}

function normalizeRuntimePlanOptions(options = {}) {
  return {
    ...options,
    minecraftVersion: options.minecraftVersion ?? "1.21.1",
    catalogModId: options.catalogModId ?? "performance-core"
  };
}

function runtimePlanSignature(options = {}) {
  return JSON.stringify({
    minecraftVersion: options.minecraftVersion,
    catalogModId: options.catalogModId
  });
}

function createControlPlane(options = {}) {
  return options.controlPlane
    ?? options.roomControllerOptions?.controlPlane
    ?? createControlPlaneBoundaryAdapter(options.controlPlaneAdapterOptions ?? {});
}

function createRoomController(runtimePlan, runtimeBridge, controlPlane, options = {}) {
  return createDesktopRoomController(runtimePlan, {
    ...(options.roomControllerOptions ?? {}),
    controlPlane,
    runtimeBridge,
    inviteBaseUrl: options.inviteBaseUrl ?? process.env.EASY_MC_INVITE_BASE_URL
  });
}

export async function handleCommandFrame(commandHost, line) {
  if (Buffer.byteLength(line ?? "", "utf8") > MAX_FRAME_BYTES) {
    return {
      id: null,
      ok: false,
      result: blockedDto("frame_too_large", "Desktop command request is too large.")
    };
  }

  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return {
      id: null,
      ok: false,
      result: blockedDto("invalid_frame", "Desktop command frame must be valid JSON.")
    };
  }

  const id = typeof frame?.id === "number" && Number.isSafeInteger(frame.id) ? frame.id : null;
  const command = typeof frame?.command === "string" ? frame.command : "";
  const request = frame?.request && typeof frame.request === "object" && !Array.isArray(frame.request)
    ? frame.request
    : {};

  try {
    const result = await commandHost.invoke(command, { request });
    return {
      id,
      ok: true,
      result
    };
  } catch {
    return {
      id,
      ok: false,
      result: blockedDto("command_failed", "Desktop command failed.")
    };
  }
}

function runtimeBridgeOptions(options = {}) {
  return {
    onEvent: options.onRuntimeEvent,
    javaOptions: {
      allowPathCandidates: true,
      allowNetworkPaths: false,
      ...(options.javaOptions ?? {})
    },
    lifecycleOptions: {
      mode: "real",
      ...(options.lifecycleOptions ?? {})
    },
    fabricOptions: {
      fetch: globalThis.fetch?.bind(globalThis),
      ...(options.fabricOptions ?? {})
    },
    materializeOptions: {
      fetch: globalThis.fetch?.bind(globalThis),
      ...(options.materializeOptions ?? {})
    }
  };
}

function writeFrame(frame, writer = output) {
  writer.write(`${JSON.stringify(frame)}\n`);
}

function writeEventFrame(event, writer = output) {
  writeFrame({
    event: "desktop_runtime_event",
    payload: event
  }, writer);
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

function redactProcessErrorMessage(value) {
  return String(value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[redacted]")
    .replace(/\[(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{0,}\](?::\d{1,5})?/gi, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[redacted-path]")
    .replace(/(^|\s)\/(?:Users|home|var|tmp|opt)\/[^\s"'<>]+/g, "$1[redacted-path]")
    .replace(/\b(invite|inviteToken|token|secret|password|credential|authorization|cookie|session)=([^&\s"'<>]+)/gi, "$1=[redacted]")
    .replace(/\b(Bearer|Basic)\s+[^&\s"'<>]+/gi, "$1 [redacted]")
    .replace(/\b([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi, "[redacted]");
}

function isDirectExecution() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}
