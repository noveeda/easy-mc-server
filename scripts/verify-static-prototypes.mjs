import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(".");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkExists(path) {
  assert(existsSync(resolve(root, path)), `Missing expected file: ${path}`);
}

function checkScript(path) {
  try {
    new Function(read(path));
  } catch (error) {
    throw new Error(`${path} failed syntax check\n${error.message}`);
  }
}

const expectedFiles = [
  "apps/desktop/index.html",
  "apps/desktop/styles.css",
  "apps/desktop/bridge.js",
  "apps/desktop/state.js",
  "apps/desktop/app.js",
  "apps/invite-web/index.html",
  "apps/invite-web/styles.css",
  "apps/invite-web/app.js",
  "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json"
];

expectedFiles.forEach(checkExists);

const desktopHtml = read("apps/desktop/index.html");
assert(desktopHtml.includes("./styles.css"), "Desktop HTML must reference styles.css");
assert(desktopHtml.includes("./bridge.js"), "Desktop HTML must reference bridge.js");
assert(
  desktopHtml.indexOf("./bridge.js") < desktopHtml.indexOf("./state.js") &&
    desktopHtml.indexOf("./state.js") < desktopHtml.indexOf("./app.js"),
  "Desktop HTML must load bridge.js, then state.js, then app.js"
);
assert(desktopHtml.includes("./app.js"), "Desktop HTML must reference app.js");
assert(desktopHtml.includes("방 준비하기"), "Desktop app must start from the host room flow");
assert(desktopHtml.includes("친구 초대"), "Desktop app must include invite creation");
assert(desktopHtml.includes("공식 제품이 아니며"), "Desktop app must include unofficial-product wording");

const desktopBridgeSandbox = {};
runInNewContext(read("apps/desktop/bridge.js"), desktopBridgeSandbox);
assert(desktopBridgeSandbox.RoomDesktopBridge, "Desktop bridge must attach browser command helpers");

const desktopStateSandbox = {};
runInNewContext(read("apps/desktop/state.js"), desktopStateSandbox);
const { cloneInitialState, reduceRoomState } = desktopStateSandbox.RoomDesktopState;
let desktopState = cloneInitialState();
assert(!desktopState.prepared && !desktopState.open, "Desktop state must start unopened");

const prepareResult = await desktopBridgeSandbox.RoomDesktopBridge.prepareRoom({
  minecraftVersion: "1.21.1",
  pack: "performance"
});
desktopState = reduceRoomState(desktopState, { type: "bridge:result", result: prepareResult });
assert(desktopState.prepared && !desktopState.open, "Fallback prepare must make the room ready but not open");
assert(!desktopState.blocker, "Fallback prepare must not show a blocker");

const blockedOpenResult = await desktopBridgeSandbox.RoomDesktopBridge.openRoom({
  minecraftVersion: "1.21.1",
  pack: "performance"
});
desktopState = reduceRoomState(desktopState, { type: "bridge:result", result: blockedOpenResult });
assert(desktopState.prepared && !desktopState.open, "Fallback open must keep the room closed");
assert(desktopState.bridgeStatus === "blocked", "Fallback open must report a blocked bridge state");
assert(desktopState.blocker?.message, "Fallback open must expose room-language blocker copy");
assert(!desktopState.inviteLink, "Fallback blocked open must not create an invite link");
assert(desktopState.diagnostics.length > 0, "Fallback blocked open must expose advanced diagnostics");

desktopState = reduceRoomState(desktopState, {
  type: "bridge:result",
  result: {
    state: "blocked",
    summary: "Install Java 21 or newer before opening this room.",
    failure: {
      reason: "java_detection_failed",
      message: "Install Java 21 or newer before opening this room."
    },
    runtimePlan: {
      java: { detected: false, majorVersion: null },
      fabric: { loaderVersion: "0.16.10" }
    }
  }
});
assert(desktopState.bridgeStatus === "blocked", "Desktop state must understand Node bridge blocked DTOs");
assert(desktopState.blocker?.message.includes("Java 21"), "Desktop state must surface bridge failure messages");
assert(desktopState.diagnostics.some((row) => row.label === "Failure"), "Desktop state must render bridge failure diagnostics");

desktopState = reduceRoomState(desktopState, {
  type: "bridge:result",
  result: {
    state: "running",
    summary: "Room is open.",
    runtimePlan: {
      java: { detected: true, majorVersion: 21 },
      fabric: { loaderVersion: "0.16.10" }
    }
  }
});
assert(desktopState.open && !desktopState.previewOpen, "Desktop state must treat Node bridge running DTOs as real room state");

desktopState = reduceRoomState(desktopState, { type: "approve" });
assert(desktopState.request === "approved", "Approve action must resolve the pending request");

desktopState = reduceRoomState(desktopState, { type: "reset" });
assert(
  !desktopState.prepared &&
    desktopState.request === "pending" &&
    !desktopState.blocker &&
    desktopState.diagnostics.length === 0 &&
    !desktopState.inviteLink,
  "Reset action must clear blocker, diagnostics, invite, and request state"
);

const tauriCalls = [];
const desktopTauriSandbox = {
  __TAURI__: {
    core: {
      invoke(command, payload) {
        tauriCalls.push({ command, payload });
        return Promise.resolve({ status: "ready", prepared: true });
      }
    }
  }
};
runInNewContext(read("apps/desktop/bridge.js"), desktopTauriSandbox);
await desktopTauriSandbox.RoomDesktopBridge.prepareRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.openRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.closeRoom();
await desktopTauriSandbox.RoomDesktopBridge.restartRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.resetRoom();
assert(tauriCalls.length === 5, "Desktop bridge must forward all commands to Tauri invoke when available");
assert(tauriCalls[0].command === "desktop_prepare_room", "Desktop bridge must invoke the prepare command name");
assert(tauriCalls[1].command === "desktop_open_room", "Desktop bridge must invoke the open command name");
assert(tauriCalls[2].command === "desktop_close_room", "Desktop bridge must invoke the close command name");
assert(tauriCalls[3].command === "desktop_restart_room", "Desktop bridge must invoke the restart command name");
assert(tauriCalls[4].command === "desktop_reset_room", "Desktop bridge must invoke the reset command name");
assert(tauriCalls[0].payload.request.pack === "performance", "Desktop bridge must wrap command payloads as request objects");
assert(
  Object.keys(tauriCalls[2].payload.request).length === 0,
  "Desktop bridge must send an empty request object for payload-less commands"
);

const inviteHtml = read("apps/invite-web/index.html");
assert(inviteHtml.includes('name="robots" content="noindex,nofollow"'), "Invite helper must stay noindex");
assert(inviteHtml.includes('name="referrer" content="no-referrer"'), "Invite helper must keep referrer protection");
assert(inviteHtml.includes('name="viewport" content="width=device-width, initial-scale=1"'), "Invite helper must keep mobile viewport metadata");
assert(!inviteHtml.includes("state-picker"), "Invite helper must not expose QA state picker controls");
assert(inviteHtml.includes("친구 방 초대"), "Invite helper must stay friend-scoped");
assert(inviteHtml.includes('id="room-facts"'), "Invite helper must allow unavailable state to hide room details");
assert(inviteHtml.includes("공식 제품이 아니며"), "Invite helper must include unofficial-product wording");

const inviteScript = read("apps/invite-web/app.js");
const inviteStyles = read("apps/invite-web/styles.css");
assert(
  inviteScript.includes("roomFacts.hidden = Boolean(state.unavailable)"),
  "Unavailable invite state must hide room details"
);
assert(inviteStyles.includes("a:focus-visible"), "Invite helper must keep visible focus styles");
assert(inviteStyles.includes("min-height: 44px"), "Invite actions must keep touch-friendly target size");
assert(inviteStyles.includes("width: 100%"), "Invite actions must become full-width on mobile");
const inviteDom = createInviteDomSandbox("?state=unknown_state");
runInNewContext(inviteScript, inviteDom);
assert(inviteDom.elements.title.textContent === "초대를 열 수 없습니다", "Unknown invite states must fail closed");
assert(inviteDom.elements.roomFacts.hidden === true, "Unknown invite states must hide room details");

const expectedInviteStates = {
  valid: { title: "Cozy Performance Room", hidden: false, actions: 2 },
  expired: { title: "초대가 만료되었습니다", hidden: true, actions: 1 },
  revoked: { title: "초대가 취소되었습니다", hidden: true, actions: 1 },
  missing: { title: "초대를 찾을 수 없습니다", hidden: true, actions: 1 },
  invalid: { title: "초대를 열 수 없습니다", hidden: true, actions: 1 },
  unsupported: { title: "Windows PC에서 열어 주세요", hidden: true, actions: 1 },
  modrinthMissing: { title: "Modrinth App이 필요합니다", hidden: true, actions: 2 },
  pack_download_failed: { title: "팩 다운로드에 실패했습니다", hidden: true, actions: 2 },
  importFailed: { title: "팩 가져오기에 실패했습니다", hidden: true, actions: 2 },
  hostOffline: { title: "호스트가 준비되지 않았습니다", hidden: true, actions: 2 },
  approvalTimeout: { title: "승인 시간이 지났습니다", hidden: true, actions: 2 },
  pending: { title: "Cozy Performance Room", hidden: false, actions: 2 },
  unavailable: { title: "초대를 열 수 없습니다", hidden: true, actions: 1 }
};

for (const [state, expected] of Object.entries(expectedInviteStates)) {
  const stateDom = createInviteDomSandbox(`?state=${state}`);
  runInNewContext(inviteScript, stateDom);

  assert(stateDom.elements.title.textContent === expected.title, `Invite state ${state} must render the expected title`);
  assert(stateDom.elements.roomFacts.hidden === expected.hidden, `Invite state ${state} must set safe room metadata visibility`);
  assert(stateDom.elements.actions.children.length === expected.actions, `Invite state ${state} must render expected action count`);

  for (const action of stateDom.elements.actions.children) {
    assert(action.attributes.role === "button", `Invite state ${state} action must be button-focused`);
    assert(/\S/.test(action.textContent), `Invite state ${state} action must have readable text`);
    assert(action.href, `Invite state ${state} action must have a target`);
  }
}

const packTemplate = JSON.parse(
  read("packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json")
);
assert(packTemplate.dependencies.minecraft === "1.21.1", "Pack template must target Minecraft 1.21.1");
assert(packTemplate.dependencies["fabric-loader"] === "0.19.2", "Pack template must pin Fabric Loader 0.19.2");

checkScript("apps/desktop/bridge.js");
checkScript("apps/desktop/state.js");
checkScript("apps/desktop/app.js");
checkScript("apps/invite-web/app.js");

console.log("static prototype checks passed");

function createInviteDomSandbox(search) {
  const dd = [{ textContent: "" }, { textContent: "" }];
  const elements = {
    panel: { classList: { toggle() {} } },
    title: { textContent: "" },
    summary: { textContent: "" },
    actions: { children: [], replaceChildren(...children) { this.children = children; } },
    roomFacts: {
      hidden: false,
      querySelector() {
        return dd[0];
      },
      querySelectorAll() {
        return dd;
      }
    },
    trustCopy: { textContent: "" }
  };

  const selectors = new Map([
    [".invite-panel", elements.panel],
    ["#invite-title", elements.title],
    ["#invite-summary", elements.summary],
    ["#invite-actions", elements.actions],
    ["#room-facts", elements.roomFacts],
    ["#trust-copy", elements.trustCopy]
  ]);

  return {
    elements,
    window: {
      location: {
        search
      }
    },
    URLSearchParams,
    document: {
      querySelector(selector) {
        return selectors.get(selector);
      },
      createElement() {
        return {
          textContent: "",
          href: "",
          className: "",
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          }
        };
      }
    }
  };
}
