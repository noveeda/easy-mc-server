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
const inviteLink = document.querySelector("#invite-link");
const copyInviteButton = document.querySelector("#copy-invite-button");
const inviteCopy = document.querySelector("#invite-copy");
const requestRow = document.querySelector("#request-row");
const requestCount = document.querySelector("#request-count");
const runtimeRows = document.querySelector("#runtime-rows");
const diagnosticsRows = document.querySelector("#diagnostics-rows");

const hostRuntimePreview = Object.freeze({
  roomFolder: "%APPDATA%/RoomBuilder/rooms/cozy-performance",
  java: "Java 21 감지됨",
  minecraftVersion: "Minecraft 1.21.1",
  fabricLoader: "Fabric Loader 0.16.10",
  cache: "검증된 다운로드만 재사용",
  eula: "호스트 동의 후 기록",
  properties: "친구 승인 목록 사용",
  mods: ["Fabric API", "Lithium", "FerriteCore", "친구 연결 모드"],
  lifecycle: "준비 -> 여는 중 -> 열림 -> 닫는 중 -> 닫힘",
  logs: "초대 코드와 개인 식별자는 가려서 표시",
  diagnostics: [
    ["Data root", "%APPDATA%/RoomBuilder"],
    ["Room runtime", "rooms/cozy-performance/runtime"],
    ["Cache", "cache/downloads + cache/metadata"],
    ["server.properties", "white-list=true, max-players=10"],
    ["Network", "server-port=25565, bind=default"],
    ["Adapter", "simulated-process, no Minecraft launch"]
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
      return "방 열림";
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
  roomFilesRow.classList.toggle("is-blocked", roomState.bridgeStatus === "blocked");
  roomFilesTitle.textContent = roomState.prepared ? "방 파일 준비됨" : "방 파일 준비 전";
  roomFilesText.textContent = roomState.prepared
    ? roomState.blocker?.message ?? "이제 방을 열 수 있습니다."
    : "아래 버튼을 누르면 필요한 파일을 준비합니다.";
}

function renderRoomStatus() {
  const hasPendingCommand = Boolean(roomState.commandPending);
  const canOpen = roomState.prepared && !roomState.open && roomState.bridgeStatus !== "closing";
  const canClose = roomState.open || roomState.bridgeStatus === "blocked";
  const canRestart = roomState.open || roomState.bridgeStatus === "blocked";

  roomStatus.textContent = getStatusCopy();
  roomStatus.classList.toggle("is-open", roomState.open);
  roomStatus.classList.toggle("is-blocked", roomState.bridgeStatus === "blocked");
  runtimePill.textContent = roomState.previewOpen ? "미리보기" : roomState.open ? "열림" : roomState.bridgeStatus === "blocked" ? "차단됨" : "대기";
  runtimePill.classList.toggle("is-warning", roomState.bridgeStatus === "blocked");
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

function renderInvite() {
  inviteLink.textContent = roomState.inviteLink ?? "방을 열면 초대 링크가 만들어집니다.";
  copyInviteButton.disabled = !roomState.inviteLink;
  inviteCopy.textContent = roomState.inviteLink
    ? "친구에게 이 링크만 보내면 됩니다. 첫 접속은 이 화면에서 승인합니다."
    : "친구는 링크를 열고 안내에 따라 모드팩을 적용한 뒤, 호스트 승인을 기다립니다.";
}

function renderRequest() {
  if (roomState.request === "pending") {
    requestCount.textContent = "1명 대기";
    requestRow.classList.remove("is-empty");
    requestRow.innerHTML = `
      <div>
        <strong>MineFriend_27</strong>
        <span>게임에서 확인된 친구입니다. 호스트 승인이 필요합니다.</span>
      </div>
      <div class="request-actions">
        <button class="secondary-button" type="button" id="deny-button">거절</button>
        <button class="primary-button" type="button" id="approve-button">승인</button>
      </div>
    `;
    requestRow.querySelector("#approve-button").addEventListener("click", () => dispatch({ type: "approve" }));
    requestRow.querySelector("#deny-button").addEventListener("click", () => dispatch({ type: "deny" }));
    return;
  }

  requestCount.textContent = "대기 없음";
  requestRow.classList.add("is-empty");
  requestRow.textContent =
    roomState.request === "approved"
      ? "MineFriend_27 님을 승인했습니다. 다음부터는 바로 들어올 수 있습니다."
      : "요청을 거절했습니다. 친구가 다시 요청할 수 있습니다.";
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
        { label: "로더", value: hostRuntimePreview.fabricLoader },
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

function render() {
  renderRoomStatus();
  renderRoomReadiness();
  renderInvite();
  renderRequest();
  renderRuntimePreview();
}

async function copyInvite() {
  if (!roomState.inviteLink) {
    return;
  }

  try {
    await navigator.clipboard.writeText(roomState.inviteLink);
    copyInviteButton.textContent = "복사됨";
    setTimeout(() => {
      copyInviteButton.textContent = "복사";
    }, 1200);
  } catch {
    inviteCopy.textContent = "복사가 막혔습니다. 링크를 직접 선택해서 복사해 주세요.";
  }
}

async function runBridgeCommand(command, status, task) {
  dispatch({ type: "bridge:pending", command, status });

  try {
    const result = await task();
    dispatch({ type: "bridge:result", result });
  } catch (error) {
    dispatch({
      type: "bridge:error",
      message: "요청을 처리하지 못했습니다.",
      diagnostics: [["Bridge error", error?.name ?? "Error"]]
    });
  }
}

prepareRoomButton.addEventListener("click", () => {
  runBridgeCommand("prepare", "preparing", () => roomBridge.prepareRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value
  }));
});

openRoomButton.addEventListener("click", () => {
  runBridgeCommand("open", "opening", () => roomBridge.openRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value
  }));
});

closeRoomButton.addEventListener("click", () => {
  runBridgeCommand("close", "closing", () => roomBridge.closeRoom());
});

restartRoomButton.addEventListener("click", () => {
  runBridgeCommand("restart", "opening", () => roomBridge.restartRoom({
    minecraftVersion: document.querySelector("#version-select").value,
    pack: document.querySelector("#pack-select").value
  }));
});

resetButton.addEventListener("click", async () => {
  dispatch({ type: "reset" });
  try {
    await roomBridge.resetRoom();
  } catch {
    // Static reset must stay usable even when a future bridge is unavailable.
  }
});
copyInviteButton.addEventListener("click", copyInvite);

render();
