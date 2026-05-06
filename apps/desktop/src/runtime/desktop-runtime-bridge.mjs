import { HostRuntimeStates, redactHostLogLine } from "./host-runtime.mjs";
import { detectWindowsJava } from "./node-java-detection.mjs";
import { bootstrapFabricServer } from "./node-fabric-bootstrap.mjs";
import {
  createLocalServerLifecycleManager,
  materializeRoom
} from "./node-local-runtime.mjs";

export const DesktopRuntimeBridgeStates = Object.freeze({
  BLOCKED: "blocked",
  PREPARING: "preparing",
  OPENING: "opening",
  CLOSING: "closing",
  ...HostRuntimeStates
});

export const DesktopRuntimeBridgeFailureReasons = Object.freeze({
  DUPLICATE_OPEN: "duplicate_open",
  FABRIC_DOWNLOAD_DISABLED: "fabric_download_disabled",
  JAVA_DETECTION_FAILED: "java_detection_failed",
  LIFECYCLE_FAILED: "lifecycle_failed",
  MATERIALIZATION_FAILED: "materialization_failed",
  SERVER_COMMAND_UNAVAILABLE: "server_command_unavailable"
});

const failureMessages = Object.freeze({
  [DesktopRuntimeBridgeFailureReasons.DUPLICATE_OPEN]: "The room is already opening.",
  [DesktopRuntimeBridgeFailureReasons.FABRIC_DOWNLOAD_DISABLED]: "Finish room setup before opening this room.",
  [DesktopRuntimeBridgeFailureReasons.JAVA_DETECTION_FAILED]: "Install Java 21 or newer before opening this room.",
  [DesktopRuntimeBridgeFailureReasons.LIFECYCLE_FAILED]: "The room could not be opened.",
  [DesktopRuntimeBridgeFailureReasons.MATERIALIZATION_FAILED]: "Prepare the room files before opening it.",
  [DesktopRuntimeBridgeFailureReasons.SERVER_COMMAND_UNAVAILABLE]: "Open the room before sending server commands."
});

export function createDesktopRuntimeBridge(runtimePlan, options = {}) {
  const dependencies = {
    materializeRoom: options.materializeRoom ?? materializeRoom,
    detectJava: options.detectJava ?? detectWindowsJava,
    bootstrapFabricServer: options.bootstrapFabricServer ?? bootstrapFabricServer,
    createLifecycleManager: options.createLifecycleManager ?? createLocalServerLifecycleManager
  };
  const lifecycleOptions = options.lifecycleOptions ?? options;
  const javaOptions = options.javaOptions ?? options;
  const fabricOptions = options.fabricOptions ?? options;
  const materializeOptions = options.materializeOptions ?? options;
  const events = [];

  let activePlan = cloneJson(runtimePlan);
  let lifecycleManager = null;
  let lastState = HostRuntimeStates.STOPPED;
  let lastFailure = null;

  async function prepareRoom(prepareOptions = {}) {
    lastState = DesktopRuntimeBridgeStates.PREPARING;

    const javaResult = await dependencies.detectJava(javaOptionsFor(prepareOptions));
    if (!javaResult.ok) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.JAVA_DETECTION_FAILED,
        javaResult.failure
      ));
    }

    activePlan = withDetectedJava(activePlan, javaResult.java);

    const materialized = await dependencies.materializeRoom(activePlan, {
      ...materializeOptions,
      ...lifecycleOptions,
      ...prepareOptions.materializeOptions
    });
    if (!materialized.ok) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.MATERIALIZATION_FAILED,
        materialized.failure
      ));
    }

    lastFailure = null;
    lastState = HostRuntimeStates.READY;
    return dto({
      state: lastState,
      summary: "Room files are ready.",
      runtimePlan: activePlan,
      detail: {
        materialized: sanitizeValue(materialized)
      }
    });
  }

  async function openRoom(openOptions = {}) {
    const lifecycleStatus = lifecycleManager?.status?.();
    if (isOpenState(lifecycleStatus?.state) || lifecycleStatus?.hasProcess) {
      return dto({
        state: DesktopRuntimeBridgeStates.BLOCKED,
        summary: failureMessages[DesktopRuntimeBridgeFailureReasons.DUPLICATE_OPEN],
        failure: wrapFailure(
          DesktopRuntimeBridgeFailureReasons.DUPLICATE_OPEN,
          { state: lifecycleStatus?.state ?? lastState }
        ),
        runtimePlan: activePlan
      });
    }

    lastState = DesktopRuntimeBridgeStates.OPENING;

    const javaResult = await dependencies.detectJava(javaOptionsFor(openOptions));
    if (!javaResult.ok) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.JAVA_DETECTION_FAILED,
        javaResult.failure
      ));
    }

    activePlan = withDetectedJava(activePlan, javaResult.java);

    if (openOptions.downloadFabric === true) {
      const fabricResult = await dependencies.bootstrapFabricServer(activePlan, {
        ...fabricOptions,
        ...openOptions.fabricOptions
      });
      if (!fabricResult.ok) {
        return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, fabricResult.failure);
      }
    } else if (openOptions.requireFabricDownload === true) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.FABRIC_DOWNLOAD_DISABLED
      ));
    }

    const materialized = await dependencies.materializeRoom(activePlan, {
      ...materializeOptions,
      ...lifecycleOptions,
      ...openOptions.materializeOptions
    });
    if (!materialized.ok) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.MATERIALIZATION_FAILED,
        materialized.failure
      ));
    }

    lifecycleManager ??= dependencies.createLifecycleManager(activePlan, {
      ...lifecycleOptions,
      ...openOptions.lifecycleOptions,
      onEvent: recordLifecycleEvent
    });

    const started = await lifecycleManager.start({
      ...openOptions.startOptions,
      mode: openOptions.mode ?? lifecycleOptions.mode ?? "real"
    });
    if (!started.ok) {
      return rememberFailure(DesktopRuntimeBridgeStates.BLOCKED, wrapFailure(
        DesktopRuntimeBridgeFailureReasons.LIFECYCLE_FAILED,
        started.failure
      ));
    }

    lastFailure = null;
    lastState = started.state ?? lifecycleManager.status?.().state ?? HostRuntimeStates.STARTING;
    return dto({
      state: lastState,
      summary: "Room is opening.",
      runtimePlan: activePlan
    });
  }

  async function closeRoom(closeOptions = {}) {
    lastState = DesktopRuntimeBridgeStates.CLOSING;
    const stopped = lifecycleManager
      ? await lifecycleManager.stop(closeOptions)
      : { ok: true, state: HostRuntimeStates.STOPPED };

    if (!stopped.ok) {
      return rememberFailure(HostRuntimeStates.FAILED, stopped.failure);
    }

    lastFailure = null;
    lastState = stopped.state ?? HostRuntimeStates.STOPPED;
    return dto({
      state: lastState,
      summary: "Room is closed.",
      runtimePlan: activePlan
    });
  }

  async function restartRoom(restartOptions = {}) {
    if (!lifecycleManager) {
      return openRoom(restartOptions.start ?? restartOptions);
    }

    lastState = HostRuntimeStates.RESTARTING;
    const restarted = await lifecycleManager.restart(restartOptions);
    if (!restarted.ok) {
      return rememberFailure(HostRuntimeStates.FAILED, restarted.failure);
    }

    lastFailure = null;
    lastState = restarted.state ?? lifecycleManager.status?.().state ?? HostRuntimeStates.STARTING;
    return dto({
      state: lastState,
      summary: "Room is restarting.",
      runtimePlan: activePlan
    });
  }

  async function sendServerCommand(commandOptions = {}) {
    const lifecycleStatus = lifecycleManager?.status?.();
    if (!canSendServerCommand(lifecycleManager, lifecycleStatus)) {
      return dto({
        state: lifecycleStatus?.state ?? lastState,
        summary: failureMessages[DesktopRuntimeBridgeFailureReasons.SERVER_COMMAND_UNAVAILABLE],
        failure: wrapFailure(
          DesktopRuntimeBridgeFailureReasons.SERVER_COMMAND_UNAVAILABLE,
          { state: lifecycleStatus?.state ?? lastState }
        ),
        runtimePlan: activePlan,
        metrics: lifecycleStatus?.metrics,
        events: mergedLifecycleEvents(lifecycleStatus)
      });
    }

    const sent = await lifecycleManager.sendCommand(commandOptions);
    const nextStatus = lifecycleManager.status?.();
    if (!sent.ok) {
      return dto({
        state: nextStatus?.state ?? lastState,
        summary: sent.failure?.message,
        failure: sent.failure,
        runtimePlan: activePlan,
        metrics: nextStatus?.metrics,
        events: mergedLifecycleEvents(nextStatus)
      });
    }

    lastFailure = null;
    lastState = nextStatus?.state ?? sent.state ?? lastState;
    return dto({
      state: lastState,
      summary: "Server command sent.",
      runtimePlan: activePlan,
      metrics: nextStatus?.metrics,
      events: mergedLifecycleEvents(nextStatus)
    });
  }

  function status() {
    const lifecycleStatus = lifecycleManager?.status?.();
    const state = lifecycleStatus?.state ?? lastState;

    return dto({
      state,
      summary: summaryForState(state, lastFailure),
      failure: lastFailure,
      runtimePlan: activePlan,
      metrics: lifecycleStatus?.metrics,
      events: mergedLifecycleEvents(lifecycleStatus)
    });
  }

  function recordLifecycleEvent(event) {
    events.push(sanitizeEvent(event));
    options.onEvent?.(sanitizeEvent(event));
  }

  function mergedLifecycleEvents(lifecycleStatus) {
    return [
      ...events,
      ...sanitizeEvents(lifecycleStatus?.events ?? [])
    ];
  }

  function rememberFailure(state, failure) {
    lastState = state;
    lastFailure = sanitizeFailure(failure);
    return dto({
      state,
      summary: lastFailure.message ?? summaryForState(state, lastFailure),
      failure: lastFailure,
      runtimePlan: activePlan
    });
  }

  function javaOptionsFor(commandOptions) {
    return {
      ...javaOptions,
      ...commandOptions.javaOptions,
      minimumMajorVersion: commandOptions.minimumMajorVersion
        ?? javaOptions.minimumMajorVersion
        ?? activePlan?.java?.minimumMajorVersion
        ?? activePlan?.java?.adapterContract?.minimumMajorVersion
    };
  }

  return {
    prepareRoom,
    openRoom,
    closeRoom,
    restartRoom,
    sendServerCommand,
    status
  };
}

function dto(input) {
  return {
    state: input.state,
    summary: input.summary ?? summaryForState(input.state, input.failure),
    ...(input.failure ? { failure: sanitizeFailure(input.failure) } : {}),
    ...(input.runtimePlan ? { runtimePlan: summarizeRuntimePlan(input.runtimePlan) } : {}),
    ...(input.metrics ? { metrics: sanitizeValue(input.metrics) } : {}),
    ...(input.events ? { events: sanitizeEvents(input.events) } : {}),
    ...(input.detail ? { detail: sanitizeValue(input.detail) } : {})
  };
}

function withDetectedJava(runtimePlan, java) {
  const next = cloneJson(runtimePlan);
  next.java = {
    ...(next.java ?? {}),
    path: java.path,
    majorVersion: java.majorVersion,
    version: java.version,
    vendor: java.vendor ?? null,
    source: java.source ?? null,
    detected: true
  };
  if (Array.isArray(next.command) && next.command.length > 0) {
    next.command[0] = java.path;
  }
  return next;
}

function isOpenState(state) {
  return [
    HostRuntimeStates.STARTING,
    HostRuntimeStates.RUNNING,
    HostRuntimeStates.STOPPING,
    HostRuntimeStates.RESTARTING
  ].includes(state);
}

function canAcceptServerCommandState(state) {
  return [
    HostRuntimeStates.STARTING,
    HostRuntimeStates.RUNNING,
    HostRuntimeStates.RESTARTING
  ].includes(state);
}

function canSendServerCommand(lifecycleManager, lifecycleStatus) {
  return Boolean(lifecycleManager)
    && lifecycleStatus?.hasProcess === true
    && canAcceptServerCommandState(lifecycleStatus?.state);
}

function wrapFailure(reason, cause = {}) {
  return {
    reason,
    message: cause?.message ?? failureMessages[reason] ?? "The room action was blocked.",
    detail: cause?.reason
      ? {
          reason: cause.reason,
          detail: cause.detail
        }
      : sanitizeValue(cause)
  };
}

function sanitizeFailure(failure = {}) {
  return {
    reason: failure.reason ?? "unknown",
    message: redactHostLogLine(failure.message ?? "The room action was blocked."),
    ...(failure.detail ? { detail: sanitizeValue(failure.detail) } : {})
  };
}

function summarizeRuntimePlan(runtimePlan = {}) {
  return sanitizeValue({
    room: runtimePlan.room ? {
      id: runtimePlan.room.id,
      name: runtimePlan.room.name,
      minecraftVersion: runtimePlan.room.minecraftVersion,
      channel: runtimePlan.room.channel
    } : null,
    lifecycle: runtimePlan.lifecycle ? {
      current: runtimePlan.lifecycle.current,
      next: runtimePlan.lifecycle.next,
      adapter: runtimePlan.lifecycle.adapter
    } : null,
    java: runtimePlan.java ? {
      detected: Boolean(runtimePlan.java.detected || runtimePlan.java.path),
      majorVersion: runtimePlan.java.majorVersion,
      vendor: runtimePlan.java.vendor ?? null,
      source: runtimePlan.java.source ?? null
    } : null,
    fabric: runtimePlan.fabric ? {
      loaderVersion: runtimePlan.fabric.loaderVersion,
      installerVerified: runtimePlan.fabric.installerVerified === true,
      hasLauncherJar: Boolean(runtimePlan.fabric.launcherJar),
      checksumRequired: Boolean(runtimePlan.fabric.serverJarSha256)
    } : null,
    pack: runtimePlan.pack ? {
      id: runtimePlan.pack.id,
      fixed: runtimePlan.pack.fixed === true,
      checksumVerified: runtimePlan.pack.checksumVerified === true
    } : null
  });
}

function sanitizeEvents(events = []) {
  return events.map((event) => sanitizeEvent(event));
}

function sanitizeEvent(event = {}) {
  return sanitizeValue(event);
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    return redactHostLogLine(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSecretKey(key))
        .map(([key, entry]) => [key, sanitizeValue(entry)])
    );
  }

  return value;
}

function isSecretKey(key) {
  return /token|secret|password|credential|authorization|cookie|invite/i.test(key);
}

function summaryForState(state, failure) {
  if (failure) {
    return failure.message;
  }

  return {
    [DesktopRuntimeBridgeStates.BLOCKED]: "The room is blocked.",
    [DesktopRuntimeBridgeStates.PREPARING]: "Preparing room files.",
    [DesktopRuntimeBridgeStates.OPENING]: "Room is opening.",
    [DesktopRuntimeBridgeStates.CLOSING]: "Room is closing.",
    [HostRuntimeStates.READY]: "Room files are ready.",
    [HostRuntimeStates.STARTING]: "Room is opening.",
    [HostRuntimeStates.RUNNING]: "Room is open.",
    [HostRuntimeStates.STOPPING]: "Room is closing.",
    [HostRuntimeStates.RESTARTING]: "Room is restarting.",
    [HostRuntimeStates.CRASHED]: "The room stopped unexpectedly.",
    [HostRuntimeStates.FAILED]: "The room action failed.",
    [HostRuntimeStates.STOPPED]: "Room is closed."
  }[state] ?? "Room status is unknown.";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
