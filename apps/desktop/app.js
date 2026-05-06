const roomStateModel = window.RoomDesktopState;
const roomBridge = window.RoomDesktopBridge;
let roomState = roomStateModel.cloneInitialState();

const roomStatus = document.querySelector("#room-status");
const runtimePill = document.querySelector("#runtime-pill");
const roomFilesRow = document.querySelector("#room-files-row");
const roomFilesTitle = roomFilesRow.querySelector(".readiness-title");
const roomFilesText = roomFilesRow.querySelector(".readiness-text");
const prepareRoomButton = document.querySelector("#prepare-room-button");
const openRoomButton = document.querySelector("#open-room-button");
const closeRoomButton = document.querySelector("#close-room-button");
const restartRoomButton = document.querySelector("#restart-room-button");
const resetButton = document.querySelector("#reset-button");
const roomBlocker = document.querySelector("#room-blocker");
const blockerTitle = document.querySelector("#blocker-title");
const blockerMessage = document.querySelector("#blocker-message");
const runtimeRows = document.querySelector("#runtime-rows");
const diagnosticsRows = document.querySelector("#diagnostics-rows");
const subTabLinks = [...document.querySelectorAll("[data-tab-target]")];
const viewPanels = [...document.querySelectorAll(".view-panel")];
const cpuMetric = document.querySelector("#cpu-metric");
const ramMetric = document.querySelector("#ram-metric");
const uptimeMetric = document.querySelector("#uptime-metric");
const metricBasis = document.querySelector("#metric-basis");
const chartStack = document.querySelector("#chart-stack");
const chartEmptyState = document.querySelector("#chart-empty-state");
const cpuChart = document.querySelector("#cpu-chart");
const ramChart = document.querySelector("#ram-chart");
const playerChart = document.querySelector("#player-chart");
const inviteLink = document.querySelector("#invite-link");
const inviteStatePill = document.querySelector("#invite-state-pill");
const inviteCopy = document.querySelector("#invite-copy");
const copyInviteButton = document.querySelector("#copy-invite-button");
const catalogModSelect = document.querySelector("#catalog-mod-select");
const catalogGatePill = document.querySelector("#catalog-gate-pill");
const catalogModName = document.querySelector("#catalog-mod-name");
const catalogModSummary = document.querySelector("#catalog-mod-summary");
const catalogRisk = document.querySelector("#catalog-risk");
const catalogDependencies = document.querySelector("#catalog-dependencies");
const catalogConflicts = document.querySelector("#catalog-conflicts");
const catalogServerApplicability = document.querySelector("#catalog-server-applicability");
const catalogGateCopy = document.querySelector("#catalog-gate-copy");
const consoleTerminal = document.querySelector("#console-terminal");
const consoleOutput = document.querySelector("#console-output");
const consoleStatePill = document.querySelector("#console-state-pill");
const consoleCommandForm = document.querySelector("#console-command-form");
const consoleCommandInput = document.querySelector("#console-command-input");
const consoleCommandButton = document.querySelector("#console-command-button");
const STATUS_POLL_INTERVAL_MS = 2000;
const METRIC_HISTORY_LIMIT = 32;
const BLOCKED_ROOM_STATUSES = new Set(["blocked", "crashed", "failed"]);
const OPENING_ROOM_STATUSES = new Set(["starting", "running", "open", "restarting"]);
const ACTIVE_METRIC_STATUSES = new Set(["opening", "starting", "running", "open", "restarting", "stopping", "closing"]);
const RUNTIME_CLOCK_START_STATUSES = new Set(["starting", "running", "open", "restarting"]);
const RUNTIME_CLOCK_RESET_STATUSES = new Set(["idle", "ready", "stopped", "blocked", "crashed", "failed"]);
const STATUS_POLL_STATUSES = new Set(["starting", "running", "open", "restarting", "stopping", "blocked"]);
let statusPollTimer = null;
let runtimeStartedAt = null;
let lastMetricStatus = null;
let lastMetricSampleAt = 0;
let consoleCommandComposing = false;
let consoleAutoScroll = true;
let runtimeEventUnlisten = null;
let inviteCopyFeedbackTimer = null;
const metricHistory = [];

const hostRuntimePreview = Object.freeze({
  roomFolder: "앱 전용 방 폴더",
  java: "실행 환경 자동 확인",
  minecraftVersion: "Minecraft 1.21.1",
  fabricLoader: "모드 방 구성 준비",
  cache: "검증된 파일만 사용",
  eula: "호스트 동의 후 저장",
  properties: "로컬 Fabric 서버 실행",
  mods: ["Fabric API", "Lithium", "FerriteCore"],
  lifecycle: "준비 -> 여는 중 -> 열림 -> 닫는 중 -> 닫힘",
  logs: "서버 로그는 콘솔 탭에 표시",
  diagnostics: [
    ["Data root", "%APPDATA%/RoomBuilder"],
    ["Room runtime", "rooms/cozy-performance/runtime"],
    ["Cache", "cache/downloads + cache/metadata"],
    ["server.properties", "max-players=10, server-port=25565"],
    ["Network", "local host runtime"],
    ["Adapter", "Tauri command bridge"]
  ]
});

function dispatch(action) {
  roomState = roomStateModel.reduceRoomState(roomState, action);
  render();
}

function getStatusCopy() {
  const pending = roomState.commandPending;
  if (pending === "prepare") {
    return "준비 중";
  }
  if (pending === "open") {
    return "여는 중";
  }
  if (pending === "close") {
    return "닫는 중";
  }
  if (pending === "restart") {
    return "다시 여는 중";
  }

  switch (roomState.bridgeStatus) {
    case "ready":
      return "준비 완료";
    case "running":
    case "open":
      return "온라인";
    case "starting":
      return "여는 중";
    case "restarting":
      return "다시 여는 중";
    case "stopping":
      return "닫는 중";
    case "stopped":
      return "닫힘";
    case "crashed":
      return "비정상 종료";
    case "failed":
      return "열기 실패";
    case "preview-open":
      return "미리보기 열림";
    case "closing":
      return "닫는 중";
    case "blocked":
      return "열기 막힘";
    default:
      return "준비 전";
  }
}

function renderRoomReadiness() {
  roomFilesRow.classList.toggle("is-ready", roomState.prepared);
  roomFilesRow.classList.toggle("is-blocked", isBlockedRoomStatus(roomState.bridgeStatus));
  roomFilesTitle.textContent = roomState.prepared ? "방 파일 준비됨" : "방 파일 준비 전";
  roomFilesText.textContent = roomState.prepared
    ? roomState.blocker?.message ?? "이제 방을 열 수 있습니다."
    : "아래 버튼을 누르면 필요한 파일을 준비합니다.";
}

function renderInvite() {
  if (!inviteLink || !inviteStatePill || !inviteCopy || !copyInviteButton) {
    return;
  }

  const link = roomState.inviteLink;
  const hasInvite = Boolean(link);
  const shareableInvite = hasInvite && isShareableInviteLink(link);
  const active = roomState.open || isOpeningRoomStatus(roomState.bridgeStatus);
  const blocked = isBlockedRoomStatus(roomState.bridgeStatus);

  inviteLink.textContent = hasInvite
    ? link
    : blocked
      ? "초대 링크를 만들 수 없습니다."
      : active
        ? "초대 연결을 준비하는 중입니다."
        : "방을 열고 연결 준비가 끝나면 표시됩니다.";
  inviteStatePill.textContent = hasInvite
    ? shareableInvite
      ? "준비됨"
      : "개발용"
    : blocked
      ? "막힘"
      : active
        ? "준비 중"
        : "준비 전";
  inviteStatePill.classList.toggle("is-running", shareableInvite);
  inviteStatePill.classList.toggle("is-warning", (blocked && !hasInvite) || (hasInvite && !shareableInvite));
  inviteStatePill.classList.toggle("is-muted", !hasInvite && !blocked);
  inviteCopy.textContent = hasInvite
    ? shareableInvite
      ? "이 링크를 전달하면 상대방이 안내 화면에서 접속 준비를 진행할 수 있습니다."
      : "현재 링크는 개발용 주소입니다. 실제 친구 공유는 공개 초대 주소가 설정된 뒤 활성화됩니다."
    : blocked
      ? "방 실행 또는 연결 준비가 막혀 초대 링크를 표시하지 않았습니다."
      : active
        ? "서버가 완전히 준비되면 링크가 자동으로 표시됩니다."
        : "초대 연결이 준비되기 전에는 링크를 만들지 않습니다.";
  copyInviteButton.disabled = !shareableInvite;
  if (!shareableInvite) {
    copyInviteButton.textContent = "복사";
  }
}

function isShareableInviteLink(link) {
  return roomStateModel.isShareableInviteLink(link);
}

function isBlockedRoomStatus(status) {
  return BLOCKED_ROOM_STATUSES.has(status);
}

function isOpeningRoomStatus(status) {
  return OPENING_ROOM_STATUSES.has(status);
}

function isRoomOperationPending() {
  return Boolean(roomState.commandPending && roomState.commandPending !== "server-command");
}

function renderRoomStatus() {
  const hasPendingCommand = isRoomOperationPending();
  const activeRuntime = roomState.open || isOpeningRoomStatus(roomState.bridgeStatus);
  const canOpen = roomState.prepared && !activeRuntime && roomState.bridgeStatus !== "closing" && roomState.bridgeStatus !== "stopping";
  const canClose = activeRuntime;
  const canRestart = roomState.open;

  roomStatus.textContent = getStatusCopy();
  roomStatus.classList.toggle("is-open", roomState.open);
  roomStatus.classList.toggle("is-blocked", isBlockedRoomStatus(roomState.bridgeStatus));
  runtimePill.textContent = roomState.previewOpen
    ? "미리보기"
    : roomState.open
      ? "열림"
      : roomState.bridgeStatus === "blocked"
        ? "차단됨"
        : isBlockedRoomStatus(roomState.bridgeStatus)
          ? "오류"
          : "대기";
  runtimePill.classList.toggle("is-warning", isBlockedRoomStatus(roomState.bridgeStatus));
  runtimePill.classList.toggle("is-running", roomState.open);

  prepareRoomButton.disabled = hasPendingCommand || roomState.prepared;
  openRoomButton.disabled = hasPendingCommand || !canOpen;
  closeRoomButton.disabled = hasPendingCommand || !canClose;
  restartRoomButton.disabled = hasPendingCommand || !canRestart;
  resetButton.disabled = hasPendingCommand;

  roomBlocker.hidden = !roomState.blocker;
  if (roomState.blocker) {
    blockerTitle.textContent = roomState.blocker.title;
    blockerMessage.textContent = roomState.blocker.message;
  }
}

function replaceDetailRows(list, rows) {
  const items = rows.map((row) => {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    const value = document.createElement("span");

    label.textContent = row.label;
    value.textContent = row.value;
    item.append(label, value);

    return item;
  });

  list.replaceChildren(...items);
}

function renderRuntimePreview() {
  const runtimeRowsToRender = roomState.runtimeRows.length
    ? roomState.runtimeRows
    : [
        { label: "방 폴더", value: hostRuntimePreview.roomFolder },
        { label: "실행 환경", value: `${hostRuntimePreview.java} · ${hostRuntimePreview.minecraftVersion}` },
        { label: "방 구성", value: hostRuntimePreview.fabricLoader },
        { label: "준비 방식", value: `${hostRuntimePreview.cache} · ${hostRuntimePreview.eula}` },
        { label: "방 규칙", value: hostRuntimePreview.properties },
        { label: "적용 파일", value: hostRuntimePreview.mods.join(", ") },
        { label: "열고 닫기", value: hostRuntimePreview.lifecycle },
        { label: "기록", value: hostRuntimePreview.logs }
      ];

  replaceDetailRows(runtimeRows, runtimeRowsToRender);

  const diagnosticsToRender = roomState.diagnostics.length
    ? roomState.diagnostics
    : hostRuntimePreview.diagnostics.map(([label, value]) => ({ label, value }));

  replaceDetailRows(diagnosticsRows, diagnosticsToRender);
}

function renderCatalog() {
  if (!catalogModSelect || !roomState.catalog) {
    return;
  }

  const catalog = roomState.catalog;
  const selected = catalog.selected;
  const options = (catalog.candidates ?? []).map((candidate) => {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = `${candidate.badge} · ${candidate.name}`;
    return option;
  });

  catalogModSelect.replaceChildren(...options);
  catalogModSelect.value = catalog.selectedId;
  catalogGatePill.textContent = catalog.gateLabel;
  catalogGatePill.classList.toggle("is-warning", !catalog.appliedToServer);
  catalogModName.textContent = `${selected.badge} · ${selected.name}`;
  catalogModSummary.textContent = selected.summary;
  catalogRisk.textContent = `${selected.risk.label} · ${selected.risk.detail}`;
  catalogDependencies.textContent = selected.dependencies.join(", ");
  catalogConflicts.textContent = selected.conflicts.join(", ");
  catalogServerApplicability.textContent = `${selected.serverApplicability.label} · ${selected.serverApplicability.detail}`;
  catalogGateCopy.textContent = catalog.gateCopy;
}

function switchView(targetId) {
  for (const link of subTabLinks) {
    link.classList.toggle("is-active", link.dataset.tabTarget === targetId);
  }

  for (const panel of viewPanels) {
    panel.hidden = panel.id !== targetId;
  }
}

function activeRuntimeStatus(status) {
  return ACTIVE_METRIC_STATUSES.has(status);
}

function ensureRuntimeClock(status) {
  if (RUNTIME_CLOCK_START_STATUSES.has(status) && !runtimeStartedAt) {
    runtimeStartedAt = Date.now();
  }

  if (RUNTIME_CLOCK_RESET_STATUSES.has(status)) {
    runtimeStartedAt = null;
  }
}

function currentMetricSnapshot() {
  const status = roomState.bridgeStatus;
  ensureRuntimeClock(status);

  const uptimeSeconds = runtimeStartedAt ? Math.max(0, Math.floor((Date.now() - runtimeStartedAt) / 1000)) : 0;
  const active = activeRuntimeStatus(status);
  const metrics = roomState.metrics;
  const hasCpuMetric = isFiniteMetric(metrics?.cpu?.processPercent);
  const hasRamMetric = isFiniteMetric(metrics?.memory?.processPercent) || isFiniteMetric(metrics?.memory?.workingSetBytes);
  const hasMetrics = Boolean(metrics) && (hasCpuMetric || hasRamMetric);
  const cpu = hasCpuMetric ? clampPercent(metrics.cpu.processPercent) : 0;
  const ramPercent = hasRamMetric ? clampPercent(metrics.memory?.processPercent) : 0;
  const ramBytes = hasRamMetric ? Math.max(0, Number(metrics.memory?.workingSetBytes ?? 0)) : 0;
  const totalRamBytes = hasRamMetric ? Math.max(0, Number(metrics.memory?.totalBytes ?? 0)) : 0;
  const players = roomState.open ? 1 : 0;

  return {
    status,
    cpu: Math.round(cpu),
    cpuPrecise: cpu,
    ram: ramPercent,
    ramBytes,
    totalRamBytes,
    hasMetrics,
    hasCpuMetric,
    hasRamMetric,
    metricsPid: metrics?.pid ?? null,
    metricsProblem: roomState.metricsProblem ?? null,
    active,
    players,
    uptimeSeconds
  };
}

function recordMetricSample(snapshot) {
  const now = Date.now();
  const statusChanged = snapshot.status !== lastMetricStatus;
  const sampleDue = now - lastMetricSampleAt >= 1000;

  if (!statusChanged && !sampleDue && metricHistory.length > 0) {
    metricHistory[metricHistory.length - 1] = snapshot;
    return;
  }

  metricHistory.push(snapshot);
  if (metricHistory.length > METRIC_HISTORY_LIMIT) {
    metricHistory.shift();
  }

  lastMetricStatus = snapshot.status;
  lastMetricSampleAt = now;
}

function chartPolygon(values, maxValue) {
  const normalized = values.length ? values : [0];
  const denominator = Math.max(1, maxValue);
  const points = normalized.map((value, index) => {
    const x = normalized.length === 1 ? 100 : (index / (normalized.length - 1)) * 100;
    const y = 100 - Math.min(100, Math.max(0, (value / denominator) * 100));

    return `${x.toFixed(2)}% ${y.toFixed(2)}%`;
  });

  return `polygon(${points.join(", ")}, 100% 100%, 0 100%)`;
}

function formatDuration(seconds) {
  if (seconds <= 0) {
    return "0초";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}초`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}분 ${remainingSeconds}초`;
  }

  return `${hours}시간 ${remainingMinutes}분`;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(100, Math.max(0, number));
}

function isFiniteMetric(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  return Number.isFinite(Number(value));
}

function formatPercent(value) {
  const rounded = Math.round(clampPercent(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  const megabytes = value / (1024 * 1024);
  if (megabytes < 1024) {
    return `${Math.round(megabytes)} MB`;
  }

  return `${(megabytes / 1024).toFixed(1)} GB`;
}

function renderMetrics() {
  const snapshot = currentMetricSnapshot();
  recordMetricSample(snapshot);
  const waitingForMetrics = !snapshot.hasMetrics;
  const metricsProblem = snapshot.active && waitingForMetrics ? snapshot.metricsProblem : null;

  cpuMetric.textContent = snapshot.hasCpuMetric
    ? `${formatPercent(snapshot.cpuPrecise)} %`
    : metricsProblem
      ? "확인 필요"
    : snapshot.active
      ? "측정 중"
      : "대기";
  ramMetric.textContent = snapshot.hasRamMetric
    ? `${formatBytes(snapshot.ramBytes)} (${formatPercent(snapshot.ram)}%)`
    : metricsProblem
      ? "확인 필요"
    : snapshot.active
      ? "측정 중"
      : "대기";
  uptimeMetric.textContent = formatDuration(snapshot.uptimeSeconds);
  if (metricBasis) {
    metricBasis.textContent = snapshot.hasMetrics
      ? `기준: 서버 Java 프로세스 PID ${snapshot.metricsPid ?? "-"} / 전체 PC 대비${snapshot.hasCpuMetric ? "" : " · CPU 측정 중"}`
      : "기준: 서버 Java 프로세스 / 전체 PC 대비";
  }

  chartStack?.classList.toggle("is-empty", waitingForMetrics);
  chartStack?.classList.toggle("is-measuring", snapshot.active && waitingForMetrics);
  chartEmptyState?.replaceChildren(
    Object.assign(document.createElement("strong"), {
      textContent: metricsProblem
        ? "자원 수치 확인 필요"
        : snapshot.active
          ? "실시간 수치 측정 중"
          : "실시간 수치 대기 중"
    }),
    Object.assign(document.createElement("span"), {
      textContent: metricsProblem
        ? metricsProblem
        : snapshot.active
          ? "서버 Java 프로세스의 CPU와 RAM 수치를 확인하는 중입니다."
          : "방을 열면 CPU, RAM, 접속 상태가 여기에 표시됩니다."
    })
  );
  cpuChart.style.setProperty("--chart-path", chartPolygon(metricHistory.map((item) => item.cpu), 100));
  ramChart.style.setProperty("--chart-path", chartPolygon(metricHistory.map((item) => item.ram), 100));
  playerChart.style.setProperty("--player-opacity", snapshot.players ? "1" : "0.26");
  playerChart.style.setProperty("--player-level", `${Math.max(8, snapshot.players * 20)}%`);
  playerChart.classList.toggle("is-active", snapshot.players > 0);
}

function renderConsole() {
  const lines = roomState.consoleLines ?? [];
  consoleOutput.classList.toggle("is-empty", !lines.length);
  if (lines.length) {
    consoleOutput.textContent = lines.join("\n");
    if (consoleAutoScroll) {
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
  } else {
    consoleAutoScroll = true;
    consoleOutput.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "console-empty-state"
      })
    );
    consoleOutput.firstElementChild.replaceChildren(
      Object.assign(document.createElement("strong"), {
        textContent: roomState.open ? "서버 로그 수신 대기 중" : "서버 로그 대기 중"
      }),
      Object.assign(document.createElement("span"), {
        textContent: roomState.open
          ? "서버는 열렸습니다. 새 로그가 발생하면 이곳에 표시됩니다."
          : "서버를 열면 로그가 여기에 표시됩니다."
      })
    );
  }

  consoleStatePill.textContent = getStatusCopy();
  consoleStatePill.classList.toggle("is-running", roomState.open);
  consoleStatePill.classList.toggle("is-warning", isBlockedRoomStatus(roomState.bridgeStatus));
  renderConsoleCommandControls();
}

function isConsoleScrolledNearBottom() {
  if (!consoleOutput) {
    return true;
  }

  return consoleOutput.scrollHeight - consoleOutput.scrollTop - consoleOutput.clientHeight < 48;
}

function canUseConsoleCommandInput() {
  return Boolean(roomBridge.isDesktopRuntimeAvailable?.())
    && (roomState.open || isOpeningRoomStatus(roomState.bridgeStatus));
}

function canSendConsoleCommand() {
  return canUseConsoleCommandInput()
    && !roomState.commandPending
    && !consoleCommandComposing;
}

function renderConsoleCommandControls() {
  if (!consoleCommandInput || !consoleCommandButton) {
    return;
  }

  const canUse = canUseConsoleCommandInput();
  const canSend = canSendConsoleCommand();
  consoleCommandInput.disabled = !canUse;
  consoleCommandButton.disabled = !canSend || !consoleCommandInput.value.trim();
  consoleCommandButton.textContent = roomState.commandPending === "server-command" ? "전송 중" : "전송";
  consoleCommandForm?.setAttribute("aria-busy", roomState.commandPending === "server-command" ? "true" : "false");
  consoleCommandForm?.classList.toggle("is-pending", roomState.commandPending === "server-command");

  if (!roomBridge.isDesktopRuntimeAvailable?.()) {
    consoleCommandInput.placeholder = "데스크톱 앱으로 실행하면 서버 명령을 입력할 수 있습니다.";
  } else if (!roomState.open) {
    consoleCommandInput.placeholder = "방을 연 뒤 서버 명령을 입력할 수 있습니다.";
  } else if (roomState.commandPending === "server-command") {
    consoleCommandInput.placeholder = "명령 전송 중에도 다음 명령을 미리 입력할 수 있습니다.";
  } else {
    consoleCommandInput.placeholder = "예: say 안녕하세요 또는 whitelist add 플레이어명";
  }
}

function render() {
  renderRoomStatus();
  renderRoomReadiness();
  renderInvite();
  renderRuntimePreview();
  renderCatalog();
  renderMetrics();
  renderConsole();
}

async function runBridgeCommand(command, status, task) {
  dispatch({ type: "bridge:pending", command, status });

  try {
    const result = await task();
    dispatch({ type: "bridge:result", command, result });
    startStatusPolling();
    return {
      ok: bridgeResultSucceeded(result),
      result
    };
  } catch (error) {
    const message = errorMessage(error);
    dispatch({
      type: "bridge:error",
      command,
      message,
      diagnostics: [["Bridge error", errorLabel(error)]]
    });
    return {
      ok: false,
      error
    };
  }
}

function bridgeResultSucceeded(result) {
  if (result?.ok === false || result?.failure) {
    return false;
  }

  const status = result?.status ?? result?.state;
  return !["blocked", "failed"].includes(status);
}

function errorMessage(error) {
  const detail = typeof error === "string"
    ? error
    : error?.message;

  return detail
    ? `요청을 처리하지 못했습니다: ${detail}`
    : "요청을 처리하지 못했습니다.";
}

function errorLabel(error) {
  if (typeof error === "string") {
    return error;
  }

  const name = error?.name ?? "Error";
  const message = error?.message ? `: ${error.message}` : "";
  return `${name}${message}`;
}

function shouldPollStatus() {
  return Boolean(roomBridge.isDesktopRuntimeAvailable?.()) && (
    roomState.prepared ||
    roomState.open ||
    STATUS_POLL_STATUSES.has(roomState.bridgeStatus)
  );
}

function startStatusPolling() {
  if (!shouldPollStatus() || statusPollTimer) {
    return;
  }

  statusPollTimer = setInterval(refreshStatus, STATUS_POLL_INTERVAL_MS);
}

function stopStatusPolling() {
  if (!statusPollTimer) {
    return;
  }

  clearInterval(statusPollTimer);
  statusPollTimer = null;
}

async function refreshStatus() {
  if (!shouldPollStatus()) {
    stopStatusPolling();
    return;
  }

  if (roomState.commandPending) {
    return;
  }

  try {
    const result = await roomBridge.statusRoom();
    dispatch({ type: "bridge:result", result });
  } catch (error) {
    dispatch({
      type: "bridge:error",
      message: "방 상태를 확인하지 못했습니다.",
      diagnostics: [["Bridge error", error?.name ?? "Error"]]
    });
    stopStatusPolling();
  }
}

prepareRoomButton.addEventListener("click", () => {
  runBridgeCommand("prepare", "preparing", () => roomBridge.prepareRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value,
    catalogModId: roomState.catalog?.selectedId ?? "performance-core"
  }));
});

openRoomButton.addEventListener("click", () => {
  runBridgeCommand("open", "opening", () => roomBridge.openRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value,
    catalogModId: roomState.catalog?.selectedId ?? "performance-core"
  }));
});

closeRoomButton.addEventListener("click", () => {
  runBridgeCommand("close", "closing", () => roomBridge.closeRoom());
});

restartRoomButton.addEventListener("click", () => {
  runBridgeCommand("restart", "opening", () => roomBridge.restartRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value,
    catalogModId: roomState.catalog?.selectedId ?? "performance-core"
  }));
});

resetButton.addEventListener("click", async () => {
  stopStatusPolling();
  dispatch({ type: "reset" });
  try {
    await roomBridge.resetRoom();
  } catch {
    // Static reset must stay usable even when a future bridge is unavailable.
  }
});

copyInviteButton?.addEventListener("click", async () => {
  const link = roomState.inviteLink;
  if (!link || !isShareableInviteLink(link)) {
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard_unavailable");
    }
    await navigator.clipboard.writeText(link);
    copyInviteButton.textContent = "복사됨";
    clearTimeout(inviteCopyFeedbackTimer);
    inviteCopyFeedbackTimer = setTimeout(() => {
      copyInviteButton.textContent = "복사";
    }, 1400);
  } catch {
    inviteCopy.textContent = "자동 복사가 막혔습니다. 표시된 링크를 직접 선택해 복사해 주세요.";
  }
});

catalogModSelect?.addEventListener("change", () => {
  dispatch({ type: "catalog:select", modId: catalogModSelect.value });
});

consoleCommandInput?.addEventListener("input", renderConsoleCommandControls);
consoleCommandInput?.addEventListener("compositionstart", () => {
  consoleCommandComposing = true;
  renderConsoleCommandControls();
});
consoleCommandInput?.addEventListener("compositionend", () => {
  consoleCommandComposing = false;
  renderConsoleCommandControls();
});
consoleTerminal?.addEventListener("click", () => {
  if (canUseConsoleCommandInput()) {
    consoleCommandInput.focus();
  }
});
consoleOutput?.addEventListener("scroll", () => {
  consoleAutoScroll = isConsoleScrolledNearBottom();
});
consoleCommandForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const command = consoleCommandInput.value.trim();
  if (!command || consoleCommandComposing || !canSendConsoleCommand()) {
    renderConsoleCommandControls();
    return;
  }

  consoleCommandInput.value = "";
  dispatch({ type: "console:append", line: `[입력] ${command}` });
  renderConsoleCommandControls();
  consoleCommandInput.focus();

  const result = await runBridgeCommand("server-command", "commanding", () => roomBridge.sendServerCommand({
    command
  }));
  renderConsoleCommandControls();
  consoleCommandInput.focus();
});

for (const link of subTabLinks) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.tabTarget);
  });
}

render();
roomBridge.listenRuntimeEvents?.((event) => {
  dispatch({ type: "runtime:event", event });
})?.then?.((unlisten) => {
  runtimeEventUnlisten = typeof unlisten === "function" ? unlisten : null;
});
