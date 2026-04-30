(function attachRoomDesktopState(global) {
  const initialRoomState = Object.freeze({
    prepared: false,
    open: false,
    previewOpen: false,
    bridgeStatus: "idle",
    commandPending: null,
    inviteLink: null,
    blocker: null,
    diagnostics: [],
    runtimeRows: [],
    request: "pending",
    message: null
  });

  function cloneInitialState() {
    return {
      ...initialRoomState,
      diagnostics: [],
      runtimeRows: []
    };
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => {
        if (Array.isArray(row)) {
          return { label: String(row[0] ?? ""), value: String(row[1] ?? "") };
        }

        return {
          label: String(row?.label ?? row?.name ?? ""),
          value: String(row?.value ?? row?.message ?? "")
        };
      })
      .filter((row) => row.label || row.value);
  }

  function normalizeBlocker(blocker) {
    if (!blocker) {
      return null;
    }

    if (typeof blocker === "string") {
      return {
        title: "방을 열 수 없습니다",
        message: blocker
      };
    }

    return {
      title: String(blocker.title ?? "방을 열 수 없습니다"),
      message: String(blocker.message ?? blocker.detail ?? "준비가 더 필요합니다.")
    };
  }

  function blockerFromFailure(failure, summary) {
    if (!failure) {
      return null;
    }

    return normalizeBlocker({
      title: "방을 열 수 없습니다",
      message: failure.message ?? summary ?? "준비가 더 필요합니다."
    });
  }

  function normalizeStatus(result, state) {
    const rawStatus = result?.status ?? result?.state;
    if (rawStatus) {
      return String(rawStatus);
    }

    if (result?.open === true) {
      return "running";
    }

    return state.prepared ? "ready" : "idle";
  }

  function diagnosticsFromBridgeResult(result) {
    if (Array.isArray(result?.diagnostics)) {
      return result.diagnostics;
    }

    const rows = [];
    if (result?.failure?.reason) {
      rows.push(["Failure", result.failure.reason]);
    }
    if (result?.failure?.detail) {
      rows.push(["Detail", JSON.stringify(result.failure.detail)]);
    }
    if (Array.isArray(result?.events) && result.events.length > 0) {
      rows.push(["Recent events", `${result.events.length}`]);
    }
    if (result?.runtimePlan?.java) {
      rows.push(["Java", `detected=${Boolean(result.runtimePlan.java.detected)} major=${result.runtimePlan.java.majorVersion ?? "unknown"}`]);
    }
    if (result?.runtimePlan?.fabric) {
      rows.push(["Fabric", `loader=${result.runtimePlan.fabric.loaderVersion ?? "unknown"}`]);
    }

    return rows;
  }

  function applyBridgeResult(state, result) {
    const status = normalizeStatus(result, state);
    const open = status === "running" || status === "open" || status === "preview-open" || result?.open === true;
    const prepared = Boolean(result?.prepared ?? (
      state.prepared ||
      open ||
      status === "ready" ||
      status === "starting" ||
      status === "running"
    ));
    const blocker = normalizeBlocker(result?.blocker) ?? blockerFromFailure(result?.failure, result?.summary);

    return {
      ...state,
      prepared,
      open,
      previewOpen: status === "preview-open" || result?.previewOpen === true,
      bridgeStatus: status,
      commandPending: null,
      inviteLink: open ? result?.inviteLink ?? null : null,
      blocker,
      diagnostics: normalizeRows(diagnosticsFromBridgeResult(result)),
      runtimeRows: normalizeRows(result?.runtimeRows),
      message: result?.message || result?.summary ? String(result.message ?? result.summary) : null
    };
  }

  function reduceRoomState(state, action) {
    switch (action.type) {
      case "bridge:pending":
        return {
          ...state,
          commandPending: action.command,
          bridgeStatus: action.status ?? state.bridgeStatus,
          blocker: null,
          message: null
        };
      case "bridge:result":
        return applyBridgeResult(state, action.result ?? {});
      case "bridge:error":
        return {
          ...state,
          open: false,
          previewOpen: false,
          commandPending: null,
          bridgeStatus: "blocked",
          inviteLink: null,
          blocker: {
            title: "방을 열 수 없습니다",
            message: action.message ?? "요청을 처리하지 못했습니다."
          },
          diagnostics: normalizeRows(action.diagnostics)
        };
      case "approve":
        return {
          ...state,
          request: "approved"
        };
      case "deny":
        return {
          ...state,
          request: "denied"
        };
      case "reset":
        return cloneInitialState();
      default:
        return state;
    }
  }

  global.RoomDesktopState = {
    initialRoomState,
    cloneInitialState,
    reduceRoomState
  };
})(typeof window !== "undefined" ? window : globalThis);
