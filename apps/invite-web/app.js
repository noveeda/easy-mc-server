const states = {
  ready: {
    title: "Cozy Performance Room",
    summary: "호스트가 보낸 친구 모드팩을 적용한 뒤 Minecraft를 실행하세요.",
    actions: [
      { label: "친구 모드팩 받기", href: "#download-not-ready" },
      { label: "Modrinth App 열기", href: "https://modrinth.com/app", secondary: true }
    ]
  },
  modrinthMissing: {
    title: "Modrinth App이 필요합니다",
    summary: "먼저 Modrinth App을 설치한 뒤 이 초대 화면으로 돌아오세요.",
    actions: [
      { label: "Modrinth App 받기", href: "https://modrinth.com/app" },
      { label: "친구 모드팩 다시 받기", href: "#download-not-ready", secondary: true }
    ]
  },
  packDownloaded: {
    title: "모드팩을 적용하세요",
    summary: "Modrinth App에서 다운로드한 파일을 가져온 뒤 생성된 프로필을 실행하세요.",
    actions: [
      { label: "Modrinth App 열기", href: "https://modrinth.com/app" },
      { label: "다시 받기", href: "#download-not-ready", secondary: true }
    ]
  },
  importFailed: {
    title: "모드팩 적용이 안 됐습니다",
    summary: "새 파일을 다시 받은 뒤 Modrinth App에서 가져오기를 다시 시도하세요.",
    actions: [
      { label: "새 파일 받기", href: "#download-not-ready" },
      { label: "호스트에게 알리기", href: "#notify-host", secondary: true }
    ]
  },
  unsupported: {
    title: "데스크탑에서 열어 주세요",
    summary: "이 방은 Minecraft Java와 Modrinth App이 있는 데스크탑에서 들어갈 수 있습니다.",
    actions: [{ label: "링크 복사", href: "#copy-link", secondary: true }]
  },
  hostOffline: {
    title: "방이 닫혀 있습니다",
    summary: "호스트가 방을 다시 열면 같은 모드팩으로 들어갈 수 있습니다.",
    actions: [{ label: "호스트에게 알리기", href: "#notify-host", secondary: true }]
  },
  pending: {
    title: "호스트 승인을 기다리는 중",
    summary: "Minecraft를 열어 둔 상태로 기다리면 호스트가 접속 요청을 확인합니다.",
    actions: [{ label: "호스트에게 알리기", href: "#notify-host", secondary: true }]
  },
  approvalTimeout: {
    title: "아직 승인이 없습니다",
    summary: "호스트가 승인 화면을 놓쳤을 수 있습니다. 잠시 뒤 다시 요청하세요.",
    actions: [
      { label: "다시 요청", href: "#retry" },
      { label: "호스트에게 알리기", href: "#notify-host", secondary: true }
    ]
  },
  unavailable: {
    title: "초대를 사용할 수 없습니다",
    summary: "초대가 만료되었거나 호스트가 새 초대를 만들어야 합니다.",
    actions: [{ label: "호스트에게 새 초대 요청", href: "#request-new", secondary: true }],
    unavailable: true
  }
};

const panel = document.querySelector(".invite-panel");
const title = document.querySelector("#invite-title");
const summary = document.querySelector("#invite-summary");
const actions = document.querySelector("#invite-actions");
const roomFacts = document.querySelector("#room-facts");

function renderState(stateName) {
  const state = states[stateName] ?? states.ready;

  title.textContent = state.title;
  summary.textContent = state.summary;
  panel.classList.toggle("is-unavailable", Boolean(state.unavailable));
  roomFacts.hidden = Boolean(state.unavailable);
  actions.replaceChildren(
    ...state.actions.map((action) => {
      const link = document.createElement("a");
      link.textContent = action.label;
      link.href = action.href;
      link.className = action.secondary ? "secondary-action" : "action-link";
      return link;
    })
  );
}

renderState(new URLSearchParams(window.location.search).get("state") ?? "ready");
