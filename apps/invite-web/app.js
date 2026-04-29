const sharedTrustCopy =
  "생성된 팩은 원본 모드 다운로드 URL과 고정 해시를 사용합니다. 이 초대 페이지에는 공개 방 목록이나 검색 경로가 없습니다.";

const roomMetadata = {
  minecraft: "Java 1.21.1",
  profile: "MVP-0 Performance Room"
};

const states = {
  valid: {
    title: "Cozy Performance Room",
    summary: "친구 모드팩을 받은 뒤 Minecraft Java를 열고 호스트 승인을 기다리세요.",
    trustCopy: sharedTrustCopy,
    actions: [
      { label: "친구 모드팩 받기", href: "#download-pack" },
      { label: "Modrinth App 열기", href: "https://modrinth.com/app", secondary: true }
    ]
  },
  expired: {
    title: "초대가 만료되었습니다",
    summary: "호스트에게 새 초대를 요청하세요.",
    actions: [{ label: "새 초대 요청", href: "#request-new" }],
    unavailable: true
  },
  revoked: {
    title: "초대가 취소되었습니다",
    summary: "호스트가 방을 다시 열 준비가 되면 새 초대를 보낼 수 있습니다.",
    actions: [{ label: "호스트에게 알리기", href: "#notify-host", secondary: true }],
    unavailable: true
  },
  missing: {
    title: "초대를 찾을 수 없습니다",
    summary: "링크가 끝까지 복사되었는지 확인한 뒤 다시 열어 주세요.",
    actions: [{ label: "링크 다시 붙여넣기", href: "#paste-invite" }],
    unavailable: true
  },
  invalid: {
    title: "초대를 열 수 없습니다",
    summary: "호스트가 보낸 최신 링크를 사용하세요.",
    actions: [{ label: "다른 초대 열기", href: "#open-another" }],
    unavailable: true
  },
  unsupported: {
    title: "Windows PC에서 열어 주세요",
    summary: "이 알파 팩은 Minecraft Java와 Modrinth App이 있는 Windows 데스크탑용입니다.",
    actions: [{ label: "링크 복사", href: "#copy-link", secondary: true }],
    unavailable: true
  },
  modrinth: {
    title: "Modrinth App이 필요합니다",
    summary: "Modrinth App을 설치한 뒤 이 초대 화면으로 돌아오세요.",
    actions: [
      { label: "Modrinth App 받기", href: "https://modrinth.com/app" },
      { label: "다시 시도", href: "#retry", secondary: true }
    ],
    unavailable: true
  },
  download: {
    title: "팩 다운로드에 실패했습니다",
    summary: "다시 다운로드하세요. 계속 실패하면 호스트에게 새 초대를 요청하세요.",
    actions: [
      { label: "다운로드 다시 시도", href: "#retry-download" },
      { label: "호스트에게 알리기", href: "#notify-host", secondary: true }
    ],
    unavailable: true
  },
  import: {
    title: "팩 가져오기에 실패했습니다",
    summary: "Modrinth App을 열고 다운로드한 팩 가져오기를 다시 시도하세요.",
    actions: [
      { label: "Modrinth App 열기", href: "https://modrinth.com/app" },
      { label: "새 파일 받기", href: "#download-pack", secondary: true }
    ],
    unavailable: true
  },
  hostOffline: {
    title: "호스트가 준비되지 않았습니다",
    summary: "호스트가 방을 열면 같은 초대 화면에서 다시 시도할 수 있습니다.",
    actions: [
      { label: "다시 시도", href: "#retry" },
      { label: "호스트에게 알리기", href: "#notify-host", secondary: true }
    ],
    unavailable: true
  },
  approvalTimeout: {
    title: "승인 시간이 지났습니다",
    summary: "호스트가 승인 화면을 놓쳤을 수 있습니다. 호스트에게 알린 뒤 다시 요청하세요.",
    actions: [
      { label: "다시 요청", href: "#retry-approval" },
      { label: "호스트에게 알리기", href: "#notify-host", secondary: true }
    ],
    unavailable: true
  },
  ready: "valid",
  active: "valid",
  modrinthMissing: "modrinth",
  modrinth_missing: "modrinth",
  pack_download_failed: "download",
  packDownloaded: "import",
  importFailed: "import",
  import_failed: "import",
  unsupported_device: "unsupported",
  host_offline: "hostOffline",
  pending: "valid",
  approval_timeout: "approvalTimeout",
  unavailable: "invalid"
};

const panel = document.querySelector(".invite-panel");
const title = document.querySelector("#invite-title");
const summary = document.querySelector("#invite-summary");
const actions = document.querySelector("#invite-actions");
const roomFacts = document.querySelector("#room-facts");
const trustCopy = document.querySelector("#trust-copy");

function renderState(stateName) {
  const state = resolveState(stateName);

  title.textContent = state.title;
  summary.textContent = state.summary;
  trustCopy.textContent = state.trustCopy ?? "초대가 유효하지 않거나 사용할 수 없을 때는 방 이름, 버전, 팩 이름을 숨깁니다.";
  panel.classList.toggle("is-unavailable", Boolean(state.unavailable));
  roomFacts.hidden = Boolean(state.unavailable);
  roomFacts.querySelector("dd").textContent = roomMetadata.minecraft;
  roomFacts.querySelectorAll("dd")[1].textContent = roomMetadata.profile;
  actions.replaceChildren(...state.actions.map(createActionLink));
}

function resolveState(stateName) {
  const candidate = states[normalizeStateName(stateName)] ?? states.invalid;
  if (typeof candidate === "string") {
    return states[candidate];
  }
  return candidate;
}

function normalizeStateName(stateName) {
  return String(stateName ?? "valid").trim().replaceAll(" ", "_").replaceAll("-", "_");
}

function createActionLink(action) {
  const link = document.createElement("a");
  link.textContent = action.label;
  link.href = action.href;
  link.className = action.secondary ? "secondary-action" : "action-link";
  link.setAttribute("role", "button");
  return link;
}

renderState(new URLSearchParams(window.location.search).get("state") ?? "valid");
