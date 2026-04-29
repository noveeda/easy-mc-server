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
assert(desktopHtml.includes("./state.js"), "Desktop HTML must load state.js before app.js");
assert(desktopHtml.includes("./app.js"), "Desktop HTML must reference app.js");
assert(desktopHtml.includes("방 준비하기"), "Desktop app must start from the host room flow");
assert(desktopHtml.includes("친구 초대"), "Desktop app must include invite creation");

const desktopStateSandbox = {};
runInNewContext(read("apps/desktop/state.js"), desktopStateSandbox);
const { cloneInitialState, reduceRoomState, fakeInvite } = desktopStateSandbox.RoomDesktopState;
let desktopState = cloneInitialState();
assert(!desktopState.prepared && !desktopState.open, "Desktop state must start unopened");

desktopState = reduceRoomState(desktopState, { type: "open" });
assert(!desktopState.open && !desktopState.inviteLink, "Desktop state must not open before prepare");

desktopState = reduceRoomState(desktopState, { type: "prepare" });
assert(desktopState.prepared && !desktopState.open, "Prepare action must make the room ready but not open");

desktopState = reduceRoomState(desktopState, { type: "open" });
assert(desktopState.open && desktopState.inviteLink === fakeInvite, "Open action must create the invite link");

desktopState = reduceRoomState(desktopState, { type: "approve" });
assert(desktopState.request === "approved", "Approve action must resolve the pending request");

desktopState = reduceRoomState(desktopState, { type: "reset" });
assert(!desktopState.prepared && desktopState.request === "pending", "Reset action must restore initial state");

const inviteHtml = read("apps/invite-web/index.html");
assert(inviteHtml.includes('name="robots" content="noindex,nofollow"'), "Invite helper must stay noindex");
assert(!inviteHtml.includes("state-picker"), "Invite helper must not expose QA state picker controls");
assert(inviteHtml.includes("친구 방 초대"), "Invite helper must stay friend-scoped");
assert(inviteHtml.includes('id="room-facts"'), "Invite helper must allow unavailable state to hide room details");

const inviteScript = read("apps/invite-web/app.js");
assert(
  inviteScript.includes("roomFacts.hidden = Boolean(state.unavailable)"),
  "Unavailable invite state must hide room details"
);

const expectedInviteStates = [
  "ready",
  "modrinthMissing",
  "packDownloaded",
  "importFailed",
  "unsupported",
  "hostOffline",
  "pending",
  "approvalTimeout",
  "unavailable"
];

for (const state of expectedInviteStates) {
  assert(inviteScript.includes(`${state}:`) || inviteScript.includes(`${state}`), `Invite app must define state: ${state}`);
}

const packTemplate = JSON.parse(
  read("packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json")
);
assert(packTemplate.dependencies.minecraft === "1.21.1", "Pack template must target Minecraft 1.21.1");
assert(packTemplate.dependencies["fabric-loader"] === "0.19.2", "Pack template must pin Fabric Loader 0.19.2");

checkScript("apps/desktop/state.js");
checkScript("apps/desktop/app.js");
checkScript("apps/invite-web/app.js");

console.log("static prototype checks passed");
