(function attachRoomDesktopState(global) {
  const catalogCandidates = Object.freeze([
    Object.freeze({
      id: "performance-core",
      name: "가벼운 친구 방",
      badge: "추천",
      summary: "Fabric API, Lithium, FerriteCore를 함께 적용하는 기본 성능 구성입니다.",
      risk: Object.freeze({
        label: "높은 신뢰",
        detail: "Minecraft 1.21.1, Fabric, Modrinth 원본 파일 hash 고정 구성을 사용합니다."
      }),
      dependencies: Object.freeze([
        "Fabric API 포함",
        "추가 의존성 없음"
      ]),
      conflicts: Object.freeze([
        "알려진 충돌 없음"
      ]),
      serverApplicability: Object.freeze({
        label: "서버 적용",
        detail: "방 준비/열기 시 검증된 파일만 서버 mods 폴더에 복사합니다."
      })
    }),
    Object.freeze({
      id: "lithium",
      name: "Lithium",
      badge: "인기",
      summary: "서버 연산 성능을 개선하는 인기 모드입니다.",
      risk: Object.freeze({
        label: "높은 신뢰",
        detail: "서버 적용 가능, Minecraft 1.21.1 Fabric 파일 hash 고정 완료."
      }),
      dependencies: Object.freeze([
        "Fabric API 자동 포함"
      ]),
      conflicts: Object.freeze([
        "알려진 충돌 없음"
      ]),
      serverApplicability: Object.freeze({
        label: "서버 적용",
        detail: "방 준비/열기 시 Fabric API와 함께 적용합니다."
      })
    }),
    Object.freeze({
      id: "ferritecore",
      name: "FerriteCore",
      badge: "추천",
      summary: "메모리 사용량을 줄이는 서버/클라이언트 공용 추천 모드입니다.",
      risk: Object.freeze({
        label: "높은 신뢰",
        detail: "Minecraft 1.21.1 Fabric 파일 hash 고정 완료."
      }),
      dependencies: Object.freeze([
        "Fabric API 자동 포함"
      ]),
      conflicts: Object.freeze([
        "알려진 충돌 없음"
      ]),
      serverApplicability: Object.freeze({
        label: "서버 적용",
        detail: "방 준비/열기 시 Fabric API와 함께 적용합니다."
      })
    })
  ]);

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
    consoleLines: [],
    metrics: null,
    metricsProblem: null,
    catalog: createCatalogAssessment(),
    request: "empty",
    message: null
  });
  const publicInviteHosts = new Set(["join.easymc.gg"]);
  const OPEN_ROOM_STATUSES = new Set(["running", "open", "preview-open"]);
  const PREPARED_ROOM_STATUSES = new Set(["ready", "starting", "running"]);
  const CONSOLE_FAILURE_STATUS_PRESERVE = new Set(["blocked", "failed"]);

  function cloneInitialState() {
    return {
      ...initialRoomState,
      diagnostics: [],
      runtimeRows: [],
      consoleLines: [],
      metrics: null,
      metricsProblem: null,
      catalog: createCatalogAssessment()
    };
  }

  function createCatalogAssessment(selectedId = catalogCandidates[0].id) {
    const selected = catalogCandidates.find((candidate) => candidate.id === selectedId) ?? catalogCandidates[0];

    return {
      selectedId: selected.id,
      gate: "m6_curated_beta",
      gateLabel: "검증된 베타",
      appliedToServer: true,
      gateCopy: "선택한 추천 구성은 방 준비/열기 요청에 포함됩니다. 원본 파일과 hash가 맞지 않으면 방 준비가 실패합니다.",
      candidates: catalogCandidates.map(toCatalogOption),
      selected: toCatalogDetail(selected)
    };
  }

  function toCatalogOption(candidate) {
    return {
      id: candidate.id,
      name: candidate.name,
      badge: candidate.badge,
      riskLabel: candidate.risk.label
    };
  }

  function toCatalogDetail(candidate) {
    return {
      id: candidate.id,
      name: candidate.name,
      badge: candidate.badge,
      summary: candidate.summary,
      risk: { ...candidate.risk },
      dependencies: [...candidate.dependencies],
      conflicts: [...candidate.conflicts],
      serverApplicability: { ...candidate.serverApplicability }
    };
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => {
        if (Array.isArray(row)) {
          return { label: redactUiText(row[0] ?? ""), value: redactUiText(row[1] ?? "") };
        }

        return {
          label: redactUiText(row?.label ?? row?.name ?? ""),
          value: redactUiText(row?.value ?? row?.message ?? "")
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
        message: redactUiText(blocker)
      };
    }

    return {
      title: redactUiText(blocker.title ?? "방을 열 수 없습니다"),
      message: redactUiText(blocker.message ?? blocker.detail ?? "준비가 더 필요합니다.")
    };
  }

  function blockerFromFailure(failure, summary) {
    if (!failure) {
      return null;
    }

    return normalizeBlocker({
      title: failureBlockerTitle(failure),
      message: failure.message ?? summary ?? "준비가 더 필요합니다."
    });
  }

  function failureBlockerTitle(failure) {
    const reason = String(failure?.reason ?? "").toLowerCase();
    if (reason.includes("command")) {
      return "명령을 보낼 수 없습니다";
    }

    if (reason.includes("java")) {
      return "실행 환경을 확인해야 합니다";
    }

    return "방을 열 수 없습니다";
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

  function consoleLinesFromBridgeResult(result, state) {
    let lines = state.consoleLines ?? [];

    if (Array.isArray(result?.events)) {
      lines = mergeConsoleLines(lines, result.events.map(formatConsoleEvent).filter(Boolean));
    }

    if (result?.failure?.message) {
      lines = mergeConsoleLines(lines, [`[오류] ${redactUiText(result.failure.message)}`]);
    }

    return lines.slice(-240);
  }

  function normalizeMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      return null;
    }

    const cpuPercent = toFiniteNumber(metrics.cpu?.processPercent);
    const workingSetBytes = toFiniteNumber(metrics.memory?.workingSetBytes);
    const totalBytes = toFiniteNumber(metrics.memory?.totalBytes);
    const memoryPercent = toFiniteNumber(metrics.memory?.processPercent);

    if (cpuPercent === null && workingSetBytes === null && memoryPercent === null) {
      return null;
    }

    return {
      pid: Number.isInteger(Number(metrics.pid)) ? Number(metrics.pid) : null,
      source: String(metrics.source ?? "process"),
      measuredAt: String(metrics.measuredAt ?? ""),
      basis: {
        process: String(metrics.basis?.process ?? "minecraft_server_java_process"),
        cpu: String(metrics.basis?.cpu ?? "process_cpu_percent_of_total_logical_cpu"),
        memory: String(metrics.basis?.memory ?? "process_working_set_percent_of_total_physical_memory")
      },
      cpu: {
        processPercent: cpuPercent
      },
      memory: {
        workingSetBytes: workingSetBytes ?? 0,
        totalBytes: totalBytes ?? 0,
        processPercent: memoryPercent ?? (
          workingSetBytes !== null && totalBytes !== null && totalBytes > 0
            ? (workingSetBytes / totalBytes) * 100
            : 0
        )
      }
    };
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function redactUiText(value) {
    return String(value ?? "")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[redacted]")
      .replace(/\[(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{0,}\](?::\d{1,5})?/gi, "[redacted]")
      .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[redacted-path]")
      .replace(/(^|\s)\/(?:Users|home|var|tmp|opt)\/[^\s"'<>]+/g, "$1[redacted-path]")
      .replace(/"((?:invite|inviteToken|token|secret|password|credential|authorization|cookie|session)[^"]*)"\s*:\s*"[^"]*"/gi, "\"$1\":\"[redacted]\"")
      .replace(/\b(invite|inviteToken|token|secret|password|credential|authorization|cookie|session)=([^&\s"'<>]+)/gi, "$1=[redacted]")
      .replace(/\b(Bearer|Basic)\s+[^&\s"'<>]+/gi, "$1 [redacted]")
      .replace(/\b([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi, "[redacted]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]");
  }

  function formatConsoleEvent(event) {
    const type = String(event?.type ?? "");
    if (type === "runtime.log" && event?.line) {
      return `[${redactUiText(event.stream ?? "server")}] ${redactUiText(event.line)}`;
    }

    if (type === "runtime.ready") {
      return "[system] 서버가 열렸습니다.";
    }

    if (type === "runtime.command" && event?.line) {
      return null;
    }

    if (type === "runtime.crashed") {
      return `[system] 서버가 비정상 종료되었습니다${event?.line ? `: ${redactUiText(event.line)}` : "."}`;
    }

    if (type === "runtime.exit") {
      return `[system] 서버 프로세스 종료: ${redactUiText(event.state ?? "unknown")}`;
    }

    if (type === "runtime.failure" && event?.failure?.message) {
      return `[오류] ${redactUiText(event.failure.message)}`;
    }

    if (type === "runtime.metrics_unavailable") {
      return event?.message
        ? `[system] 서버 자원 사용률을 아직 읽지 못했습니다: ${redactUiText(event.message)}`
        : "[system] 서버 자원 사용률을 아직 읽지 못했습니다.";
    }

    return null;
  }

  function mergeConsoleLines(existing, next) {
    const merged = [...existing];
    for (const line of next) {
      if (line && !merged.includes(line)) {
        merged.push(line);
      }
    }

    return merged;
  }

  function metricsProblemFromEvents(events) {
    if (!Array.isArray(events)) {
      return null;
    }

    for (const event of [...events].reverse()) {
      if (String(event?.type ?? "") !== "runtime.metrics_unavailable") {
        continue;
      }

      return event?.message
        ? `서버 자원 사용률을 아직 읽지 못했습니다: ${redactUiText(event.message)}`
        : "서버 자원 사용률을 아직 읽지 못했습니다.";
    }

    return null;
  }

  function isShareableInviteLink(link) {
    try {
      const url = new URL(link);
      const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
      return url.protocol === "https:"
        && !url.username
        && !url.password
        && url.searchParams.has("invite")
        && Boolean(url.searchParams.get("invite"))
        && publicInviteHosts.has(host)
        && !isReservedInviteHost(host)
        && !isPrivateIpv4(host)
        && !isPrivateIpv6(host);
    } catch {
      return false;
    }
  }

  function isReservedInviteHost(host) {
    return host === "localhost"
      || host.endsWith(".localhost")
      || host === "example.com"
      || host === "example.net"
      || host === "example.org"
      || host === "example.test"
      || host.endsWith(".example")
      || host.endsWith(".invalid")
      || host.endsWith(".test")
      || host.endsWith(".local")
      || host.endsWith(".lan");
  }

  function isPrivateIpv4(host) {
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 169 && parts[1] === 254);
  }

  function isPrivateIpv6(host) {
    return host === "::"
      || host === "::1"
      || host.startsWith("fc")
      || host.startsWith("fd")
      || host.startsWith("fe80");
  }

  function isConsoleCommandFailure(command, result) {
    return command === "server-command" && Boolean(result?.failure);
  }

  function effectiveBridgeStatus(status, state, preserveCurrentStatus) {
    if (preserveCurrentStatus && CONSOLE_FAILURE_STATUS_PRESERVE.has(status)) {
      return state.bridgeStatus;
    }

    return status;
  }

  function roomOpenFromResult(result, effectiveStatus, preserveCurrentOpen, state) {
    if (preserveCurrentOpen) {
      return state.open;
    }

    return OPEN_ROOM_STATUSES.has(effectiveStatus) || result?.open === true;
  }

  function roomPreparedFromResult(result, state, open, effectiveStatus) {
    return Boolean(result?.prepared ?? (
      state.prepared ||
      open ||
      PREPARED_ROOM_STATUSES.has(effectiveStatus)
    ));
  }

  function applyBridgeResult(state, result, command) {
    const status = normalizeStatus(result, state);
    const preserveConsoleState = isConsoleCommandFailure(command, result);
    const effectiveStatus = effectiveBridgeStatus(status, state, preserveConsoleState);
    const open = roomOpenFromResult(result, effectiveStatus, preserveConsoleState, state);
    const prepared = roomPreparedFromResult(result, state, open, effectiveStatus);
    const blocker = normalizeBlocker(result?.blocker) ?? blockerFromFailure(result?.failure, result?.summary);
    const metrics = normalizeMetrics(result?.metrics);
    const metricsProblem = metrics
      ? null
      : metricsProblemFromEvents(result?.events) ?? (preserveConsoleState ? state.metricsProblem : null);
    const inviteReady = inviteReadinessComplete(result, open);

    return {
      ...state,
      prepared,
      open,
      previewOpen: preserveConsoleState
        ? state.previewOpen
        : effectiveStatus === "preview-open" || result?.previewOpen === true,
      bridgeStatus: effectiveStatus,
      commandPending: null,
      inviteLink: inviteReady && isShareableInviteLink(result.inviteLink) ? result.inviteLink : null,
      blocker,
      diagnostics: normalizeRows(diagnosticsFromBridgeResult(result)),
      runtimeRows: normalizeRows(result?.runtimeRows),
      consoleLines: consoleLinesFromBridgeResult(result, state),
      metrics: metrics ?? (preserveConsoleState ? state.metrics : null),
      metricsProblem,
      message: result?.message || result?.summary ? redactUiText(result.message ?? result.summary) : null
    };
  }

  function inviteReadinessComplete(result, open) {
    return Boolean(open)
      && typeof result?.inviteLink === "string"
      && result.inviteLink.length > 0
      && result?.controlPlane?.ready === true
      && result?.controlPlane?.invite?.ready === true
      && result?.relay?.ready === true
      && result?.relay?.session?.ready === true;
  }

  function reduceRoomState(state, action) {
    switch (action.type) {
      case "bridge:pending":
        const isConsolePending = action.command === "server-command";
        return {
          ...state,
          commandPending: action.command,
          bridgeStatus: isConsolePending ? state.bridgeStatus : action.status ?? state.bridgeStatus,
          blocker: null,
          metrics: state.metrics,
          metricsProblem: isConsolePending ? state.metricsProblem : null,
          message: null
        };
      case "console:append":
        return {
          ...state,
          consoleLines: [...(state.consoleLines ?? []), redactUiText(action.line ?? "")].filter(Boolean).slice(-240)
        };
      case "runtime:event":
        return applyRuntimeEvent(state, action.event ?? {});
      case "catalog:select":
        return {
          ...state,
          catalog: createCatalogAssessment(action.modId)
        };
      case "bridge:result":
        return applyBridgeResult(state, action.result ?? {}, action.command);
      case "bridge:error": {
        const isConsoleCommand = action.command === "server-command";
        return {
          ...state,
          open: isConsoleCommand ? state.open : false,
          previewOpen: isConsoleCommand ? state.previewOpen : false,
          commandPending: null,
          bridgeStatus: isConsoleCommand ? state.bridgeStatus : "blocked",
          inviteLink: isConsoleCommand ? state.inviteLink : null,
          blocker: {
            title: isConsoleCommand ? "명령을 보낼 수 없습니다" : "방을 열 수 없습니다",
            message: redactUiText(action.message ?? "요청을 처리하지 못했습니다.")
          },
          diagnostics: normalizeRows(action.diagnostics),
          consoleLines: mergeConsoleLines(state.consoleLines ?? [], [`[오류] ${redactUiText(action.message ?? "요청을 처리하지 못했습니다.")}`]),
          metrics: isConsoleCommand ? state.metrics : null,
          metricsProblem: isConsoleCommand ? state.metricsProblem : null
        };
      }
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

  function applyRuntimeEvent(state, event) {
    const line = formatConsoleEvent(event);
    const type = String(event?.type ?? "");
    const patch = {
      bridgeStatus: state.bridgeStatus,
      open: state.open,
      prepared: state.prepared,
      blocker: state.blocker,
      metrics: state.metrics,
      metricsProblem: state.metricsProblem,
      inviteLink: state.inviteLink
    };

    if (type === "runtime.ready") {
      patch.bridgeStatus = "running";
      patch.open = true;
      patch.prepared = true;
      patch.blocker = null;
    } else if (type === "runtime.crashed") {
      patch.bridgeStatus = "crashed";
      patch.open = false;
      patch.inviteLink = null;
      patch.blocker = normalizeBlocker({
        title: "서버가 비정상 종료되었습니다",
        message: event?.line ?? "서버 로그를 확인해 주세요."
      });
    } else if (type === "runtime.failure") {
      patch.bridgeStatus = "failed";
      patch.open = false;
      patch.inviteLink = null;
      patch.blocker = blockerFromFailure(event.failure, event.failure?.message);
    } else if (type === "runtime.exit") {
      const nextStatus = String(event?.state ?? "stopped");
      patch.bridgeStatus = nextStatus;
      patch.open = nextStatus === "running" || nextStatus === "open";
      patch.inviteLink = patch.open ? state.inviteLink : null;
      patch.metricsProblem = null;
    } else if (type === "runtime.metrics_unavailable") {
      patch.metricsProblem = metricsProblemFromEvents([event]);
    }

    return {
      ...state,
      ...patch,
      consoleLines: line
        ? mergeConsoleLines(state.consoleLines ?? [], [line]).slice(-240)
        : state.consoleLines
    };
  }

  global.RoomDesktopState = {
    initialRoomState,
    cloneInitialState,
    reduceRoomState,
    createCatalogAssessment,
    isShareableInviteLink
  };
})(typeof window !== "undefined" ? window : globalThis);
