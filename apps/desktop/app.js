const roomStateModel = window.RoomDesktopState;
let roomState = roomStateModel.cloneInitialState();

const roomStatus = document.querySelector("#room-status");
const roomFilesRow = document.querySelector("#room-files-row");
const roomFilesTitle = roomFilesRow.querySelector(".readiness-title");
const roomFilesText = roomFilesRow.querySelector(".readiness-text");
const prepareRoomButton = document.querySelector("#prepare-room-button");
const openRoomButton = document.querySelector("#open-room-button");
const resetButton = document.querySelector("#reset-button");
const inviteLink = document.querySelector("#invite-link");
const copyInviteButton = document.querySelector("#copy-invite-button");
const inviteCopy = document.querySelector("#invite-copy");
const requestRow = document.querySelector("#request-row");
const requestCount = document.querySelector("#request-count");

function dispatch(action) {
  roomState = roomStateModel.reduceRoomState(roomState, action);
  render();
}

function renderRoomReadiness() {
  roomFilesRow.classList.toggle("is-ready", roomState.prepared);
  roomFilesTitle.textContent = roomState.prepared ? "방 파일 준비됨" : "방 파일 준비 전";
  roomFilesText.textContent = roomState.prepared
    ? "이제 방을 열 수 있습니다."
    : "아래 버튼을 누르면 필요한 파일을 준비합니다.";
}

function renderRoomStatus() {
  roomStatus.textContent = roomState.open ? "방 열림" : roomState.prepared ? "준비 완료" : "준비 전";
  roomStatus.classList.toggle("is-open", roomState.open);
  prepareRoomButton.disabled = roomState.prepared;
  openRoomButton.disabled = !roomState.prepared || roomState.open;
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
        <span>처음 들어오는 친구입니다.</span>
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

function render() {
  renderRoomStatus();
  renderRoomReadiness();
  renderInvite();
  renderRequest();
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

prepareRoomButton.addEventListener("click", () => dispatch({ type: "prepare" }));
openRoomButton.addEventListener("click", () => dispatch({ type: "open" }));
resetButton.addEventListener("click", () => dispatch({ type: "reset" }));
copyInviteButton.addEventListener("click", copyInvite);

render();
