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
  "apps/desktop/dev-hot-reload.js",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/build.rs",
  "apps/desktop/src-tauri/capabilities/default.json",
  "apps/desktop/src-tauri/icons/icon.ico",
  "apps/desktop/src-tauri/src/main.rs",
  "apps/desktop/src/runtime/desktop-dev-runtime-plan.mjs",
  "apps/desktop/src/runtime/control-plane-boundary-adapter.mjs",
  "apps/desktop/src/runtime/desktop-command-host-process.mjs",
  "scripts/desktop-dev-hot.mjs",
  "apps/invite-web/index.html",
  "apps/invite-web/styles.css",
  "apps/invite-web/app.js",
  "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json"
];

expectedFiles.forEach(checkExists);

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts?.["desktop:dev"] === "node scripts/desktop-dev-hot.mjs",
  "Desktop dev script must run the hot reload wrapper by default"
);
assert(
  packageJson.scripts?.["desktop:dev:plain"] === "node scripts/desktop-cargo.mjs run",
  "Desktop dev must keep a plain Cargo-backed fallback command"
);

const desktopHtml = read("apps/desktop/index.html");
assert(desktopHtml.includes("./styles.css"), "Desktop HTML must reference styles.css");
assert(desktopHtml.includes("./bridge.js"), "Desktop HTML must reference bridge.js");
assert(
  desktopHtml.indexOf("./bridge.js") < desktopHtml.indexOf("./state.js") &&
    desktopHtml.indexOf("./state.js") < desktopHtml.indexOf("./app.js"),
  "Desktop HTML must load bridge.js, then state.js, then app.js"
);
assert(desktopHtml.includes("./app.js"), "Desktop HTML must reference app.js");
assert(!desktopHtml.includes("./dev-hot-reload.js"), "Desktop packaged HTML must not include the development hot reload helper");
assert(desktopHtml.includes("방 준비하기"), "Desktop app must start from the host room flow");
assert(desktopHtml.includes("공식 제품이 아니며"), "Desktop app must include unofficial-product wording");
assert(desktopHtml.includes("window-shell"), "Desktop app must use a native desktop shell layout");
assert(desktopHtml.includes('data-tab-target="console-view"'), "Desktop app must wire the console sub-tab");
assert(desktopHtml.includes('id="console-view"'), "Desktop app must include a console panel");
assert(desktopHtml.includes('id="console-terminal"'), "Desktop app must render the console as an integrated terminal surface");
assert(desktopHtml.includes('id="console-command-input"'), "Desktop app must include a server command input");
assert(desktopHtml.includes('id="console-command-button"'), "Desktop app must include a server command send button");
assert(desktopHtml.includes('id="invite-link"'), "Desktop app must show a real invite-link target");
assert(desktopHtml.includes('id="copy-invite-button"'), "Desktop app must expose invite copying only after an invite exists");
assert(desktopHtml.includes('id="cpu-chart"'), "Desktop app must expose a live CPU chart target");
assert(desktopHtml.includes('id="ram-chart"'), "Desktop app must expose a live RAM chart target");
assert(desktopHtml.includes('id="player-chart"'), "Desktop app must expose a live player chart target");
assert(desktopHtml.includes('id="metric-basis"'), "Desktop app must explain the CPU/RAM metric basis");
assert(desktopHtml.includes("서버 CPU") && desktopHtml.includes("전체 CPU 중 점유율"), "Desktop app must label CPU as server-process total CPU share");
assert(desktopHtml.includes("서버 RAM") && desktopHtml.includes("전체 메모리 중 점유율"), "Desktop app must label RAM as server-process total memory share");
assert(desktopHtml.includes("현재 가능"), "Desktop app must show the currently supported MVP-0 scope");
assert(desktopHtml.includes("초대 링크 표시와 복사"), "Desktop app must list real invite-link display as a supported MVP-0 surface");
for (const tabLabel of ["대시보드", "콘솔"]) {
  assert(desktopHtml.includes(tabLabel), `Desktop app must include supported Korean room tab ${tabLabel}`);
}
for (const unsupportedCopy of ["친구 초대", "접속 요청", "강제 종료", "백업", "예약", "웹 패널", "방 목록"]) {
  assert(!desktopHtml.includes(unsupportedCopy), `Desktop app must not show unsupported MVP-0 surface: ${unsupportedCopy}`);
}

const desktopStyles = read("apps/desktop/styles.css");
assert(
  desktopStyles.includes("height: 100%;") &&
    desktopStyles.includes("height: 100vh;") &&
    desktopStyles.includes("overflow: hidden;"),
  "Desktop shell CSS must pin the root layout so Tauri hot reload cannot collapse the body"
);
assert(
  desktopStyles.includes(".console-terminal") &&
    desktopStyles.includes(".console-prompt-symbol") &&
    desktopStyles.includes("cursor: text"),
  "Desktop console must use a Docker Desktop-style integrated terminal surface"
);

const desktopBridgeSandbox = {};
runInNewContext(read("apps/desktop/bridge.js"), desktopBridgeSandbox);
assert(desktopBridgeSandbox.RoomDesktopBridge, "Desktop bridge must attach browser command helpers");
assert(
  desktopBridgeSandbox.RoomDesktopBridge.isDesktopRuntimeAvailable() === false,
  "Desktop bridge must expose whether the Tauri runtime is available"
);

const desktopStateScript = read("apps/desktop/state.js");
const desktopStateSandbox = { URL };
runInNewContext(desktopStateScript, desktopStateSandbox);
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
    events: [
      { type: "runtime.log", stream: "stdout", line: "[Server thread/INFO]: Done (2.0s)! For help, type \"help\"" },
      { type: "runtime.ready" }
    ],
    metrics: {
      pid: 4321,
      source: "test-process",
      measuredAt: "2026-05-02T00:00:00.000Z",
      cpu: { processPercent: 12.5 },
      memory: {
        workingSetBytes: 512 * 1024 * 1024,
        totalBytes: 16 * 1024 * 1024 * 1024,
        processPercent: 3.125
      }
    },
    runtimePlan: {
      java: { detected: true, majorVersion: 21 },
      fabric: { loaderVersion: "0.16.10" }
    }
  }
});
assert(desktopState.open && !desktopState.previewOpen, "Desktop state must treat Node bridge running DTOs as real room state");
assert(
  desktopState.consoleLines.some((line) => line.includes("Done (2.0s)!")) &&
    desktopState.consoleLines.some((line) => line.includes("서버가 열렸습니다")),
  "Desktop state must convert bridge runtime events into console lines"
);
assert(desktopState.metrics?.pid === 4321, "Desktop state must store process metric PID");
assert(desktopState.metrics?.cpu.processPercent === 12.5, "Desktop state must store process CPU share");
assert(desktopState.metrics?.memory.processPercent === 3.125, "Desktop state must store process memory share");

desktopState = reduceRoomState(desktopState, {
  type: "bridge:result",
  result: {
    state: "running",
    open: true,
    inviteLink: "https://join.easymc.gg/invite?invite=public-room-token",
    controlPlane: { ready: true, room: { ready: true }, invite: { ready: true } },
    relay: { ready: true, session: { ready: true } }
  }
});
assert(
  desktopState.open && desktopState.inviteLink === "https://join.easymc.gg/invite?invite=public-room-token",
  "Desktop state must surface real invite links only after a running bridge result"
);

desktopState = reduceRoomState(desktopState, {
  type: "bridge:pending",
  command: "server-command",
  status: "commanding"
});
assert(desktopState.bridgeStatus === "running", "Console command pending state must not make an online room look busy or closed");
assert(desktopState.commandPending === "server-command", "Console command pending state must still track command submission");

desktopState = reduceRoomState(desktopState, {
  type: "console:append",
  line: "[입력] say hello"
});
assert(
  desktopState.consoleLines.at(-1) === "[입력] say hello",
  "Console commands must echo immediately before bridge round-trip completes"
);

desktopState = reduceRoomState(desktopState, {
  type: "runtime:event",
  event: {
    type: "runtime.log",
    stream: "Server",
    line: "hello world from 192.168.0.12:51234 at C:/Users/Alice/AppData/server.log"
  }
});
assert(
  desktopState.consoleLines.at(-1) === "[Server] hello world from [redacted] at [redacted-path]",
  "Runtime event streaming must append server output without waiting for status polling"
);

desktopState = reduceRoomState(desktopState, {
  type: "bridge:result",
  command: "server-command",
  result: {
    state: "blocked",
    failure: {
      reason: "command_unavailable",
      message: "Desktop command is unavailable: desktop_send_server_command"
    }
  }
});
assert(desktopState.open, "Console command failures must not make an online room look closed");
assert(desktopState.bridgeStatus === "running", "Console command failures must preserve the running room status");
assert(desktopState.blocker?.title === "명령을 보낼 수 없습니다", "Console command failures must show command-specific blocker copy");
assert(
  desktopState.consoleLines.some((line) => line.includes("desktop_send_server_command")),
  "Console command failures must be visible in the console log"
);

desktopState = reduceRoomState(desktopState, {
  type: "bridge:error",
  command: "server-command",
  message: "요청을 처리하지 못했습니다: Command desktop_send_server_command not found",
  diagnostics: [["Bridge error", "Command desktop_send_server_command not found"]]
});
assert(desktopState.open, "Thrown Tauri command errors must not make an online room look closed");
assert(desktopState.bridgeStatus === "running", "Thrown Tauri command errors must preserve the running room status");
assert(
  desktopState.consoleLines.some((line) => line.includes("Command desktop_send_server_command not found")),
  "Thrown Tauri command errors must be visible in the console log"
);

desktopState = reduceRoomState(desktopState, { type: "approve" });
assert(desktopState.request === "approved", "Approve action must resolve the pending request");

desktopState = reduceRoomState(desktopState, { type: "reset" });
assert(
    !desktopState.prepared &&
    desktopState.request === "empty" &&
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
    },
    event: {
      listen(name, callback) {
        callback({ payload: { type: "runtime.log", stream: "stdout", line: "[Server] hi" } });
        return Promise.resolve(() => {});
      }
    }
  }
};
runInNewContext(read("apps/desktop/bridge.js"), desktopTauriSandbox);
assert(
  desktopTauriSandbox.RoomDesktopBridge.isDesktopRuntimeAvailable() === true,
  "Desktop bridge must detect the Tauri runtime when invoke is available"
);
await desktopTauriSandbox.RoomDesktopBridge.prepareRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.openRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.closeRoom();
await desktopTauriSandbox.RoomDesktopBridge.restartRoom({ pack: "performance" });
await desktopTauriSandbox.RoomDesktopBridge.sendServerCommand({ command: "say hello" });
await desktopTauriSandbox.RoomDesktopBridge.statusRoom();
await desktopTauriSandbox.RoomDesktopBridge.resetRoom();
let listenedRuntimeEvent = null;
await desktopTauriSandbox.RoomDesktopBridge.listenRuntimeEvents((event) => {
  listenedRuntimeEvent = event;
});
assert(tauriCalls.length === 7, "Desktop bridge must forward all commands to Tauri invoke when available");
assert(tauriCalls[0].command === "desktop_prepare_room", "Desktop bridge must invoke the prepare command name");
assert(tauriCalls[1].command === "desktop_open_room", "Desktop bridge must invoke the open command name");
assert(tauriCalls[2].command === "desktop_close_room", "Desktop bridge must invoke the close command name");
assert(tauriCalls[3].command === "desktop_restart_room", "Desktop bridge must invoke the restart command name");
assert(tauriCalls[4].command === "desktop_send_server_command", "Desktop bridge must invoke the server command name");
assert(tauriCalls[5].command === "desktop_status_room", "Desktop bridge must invoke the status command name");
assert(tauriCalls[6].command === "desktop_reset_room", "Desktop bridge must invoke the reset command name");
assert(tauriCalls[0].payload.request.pack === "performance", "Desktop bridge must wrap command payloads as request objects");
assert(
  Object.keys(tauriCalls[2].payload.request).length === 0,
  "Desktop bridge must send an empty request object for payload-less commands"
);
assert(tauriCalls[4].payload.request.command === "say hello", "Desktop bridge must wrap server console commands");
assert(
  listenedRuntimeEvent?.line === "[Server] hi",
  "Desktop bridge must expose Tauri runtime event streaming for Docker Desktop-style console updates"
);

const tauriConfig = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
assert(
  Array.isArray(tauriConfig.build?.frontendDist),
  "Tauri scaffold must embed an explicit static file allowlist"
);
for (const frontendFile of ["../index.html", "../styles.css", "../bridge.js", "../state.js", "../app.js"]) {
  assert(
    tauriConfig.build.frontendDist.includes(frontendFile),
    `Tauri scaffold must embed desktop asset ${frontendFile}`
  );
}
assert(
  !tauriConfig.build.frontendDist.includes("../dev-hot-reload.js"),
  "Tauri packaged frontend assets must not embed the development hot reload helper"
);
assert(
  !tauriConfig.build.frontendDist.some((asset) => asset.includes("src-tauri")),
  "Tauri scaffold must not embed src-tauri build artifacts as frontend assets"
);
assert(tauriConfig.bundle?.active === false, "Tauri scaffold must not imply a production bundle is ready");
assert(tauriConfig.app?.windows?.[0]?.label === "main", "Tauri scaffold must define the main desktop window label");
assert(tauriConfig.app?.windows?.[0]?.title, "Tauri scaffold must define a desktop window");
assert(tauriConfig.app?.withGlobalTauri === true, "Tauri scaffold must expose window.__TAURI__ for the static desktop bridge");
assert(
  typeof tauriConfig.app?.security?.csp === "string" && tauriConfig.app.security.csp.includes("default-src 'self'"),
  "Tauri scaffold must keep an explicit local-only CSP"
);
assert(
  !tauriConfig.app.security.csp.includes("127.0.0.1:39411"),
  "Tauri packaged CSP must not include the development hot reload endpoint"
);

const desktopDevHotScript = read("scripts/desktop-dev-hot.mjs");
assert(
  desktopDevHotScript.includes("TAURI_CONFIG") &&
    desktopDevHotScript.includes("devUrl") &&
    desktopDevHotScript.includes("easy-mc-hot-reload"),
  "Desktop hot reload script must serve the desktop files and point Tauri at the dev URL"
);
assert(
  desktopDevHotScript.includes("reloadDebounceMs") &&
    desktopDevHotScript.includes("waitForReadableFrontendFile"),
  "Desktop hot reload script must debounce reloads until changed files are readable"
);
assert(
  desktopDevHotScript.includes("./dev-hot-reload.js") &&
    !desktopDevHotScript.includes("Access-Control-Allow-Origin"),
  "Desktop hot reload script must inject the dev helper only from the local dev server without wildcard CORS"
);

const tauriCapability = JSON.parse(read("apps/desktop/src-tauri/capabilities/default.json"));
assert(
  tauriCapability.windows?.includes("main") && tauriCapability.permissions?.includes("core:default"),
  "Tauri scaffold must grant the main window default core permissions for invoke"
);

const tauriCargo = read("apps/desktop/src-tauri/Cargo.toml");
assert(tauriCargo.includes("tauri"), "Tauri scaffold must declare the Tauri dependency");
assert(tauriCargo.includes("serde_json"), "Tauri scaffold must keep JSON DTO boundaries explicit");
assert(tauriCargo.includes('build = "build.rs"'), "Tauri scaffold must register build.rs for generate_context");
assert(tauriCargo.includes("tauri-build"), "Tauri scaffold must declare tauri-build as a build dependency");

const tauriBuildScript = read("apps/desktop/src-tauri/build.rs");
assert(tauriBuildScript.includes("tauri_build::build()"), "Tauri scaffold build.rs must generate Tauri context");

assert(
  readFileSync(resolve(root, "apps/desktop/src-tauri/icons/icon.ico")).length > 0,
  "Tauri scaffold must include a non-empty Windows icon resource"
);

const tauriMain = read("apps/desktop/src-tauri/src/main.rs");
const expectedTauriCommands = [
  "desktop_prepare_room",
  "desktop_open_room",
  "desktop_close_room",
  "desktop_restart_room",
  "desktop_send_server_command",
  "desktop_status_room",
  "desktop_reset_room"
];
const generateHandler = tauriMain.match(/generate_handler!\s*\[([\s\S]*?)\]/);
assert(generateHandler, "Tauri scaffold must register commands in tauri::generate_handler!");
for (const command of expectedTauriCommands) {
  assert(tauriMain.includes(`fn ${command}`), `Tauri scaffold must define Rust command ${command}`);
  assert(generateHandler[1].includes(command), `Tauri scaffold must register Rust command ${command}`);
}
assert(
  tauriMain.includes("desktop-command-host-process.mjs") &&
    tauriMain.includes("EASY_MC_NODE_PATH") &&
    tauriMain.includes("Command::new(node_command())") &&
    tauriMain.includes("stdin.write_all") &&
    tauriMain.includes("recv_timeout(COMMAND_TIMEOUT)") &&
    tauriMain.includes("desktop-runtime-event") &&
    tauriMain.includes("pending_responses") &&
    tauriMain.includes("route_node_host_stdout_line") &&
    tauriMain.includes("should_retry_after_stale_host_response") &&
    tauriMain.includes("clear_node_host(&mut state);"),
  "Tauri scaffold must broker commands to the fixed Node command host, stream runtime events, time out, and retry once after stale command-host responses"
);
assert(
  !tauriMain.includes("runtime_not_implemented") &&
    tauriMain.includes("sanitize_request") &&
    tauriMain.includes("allowed_fields_for_command") &&
    tauriMain.includes("is_safe_console_command") &&
    !tauriMain.includes('"request": request'),
  "Tauri scaffold must validate requests and must not echo raw request payloads"
);
assert(tauriMain.includes("sanitize_response"), "Tauri scaffold must sanitize Node responses before returning to the renderer");
assert(
  tauriMain.includes('key == "inviteLink" && depth > 0') &&
    tauriMain.includes('key == "inviteLink" && depth == 1'),
  "Tauri response sanitizer must preserve only the top-level public inviteLink and strip nested invite links"
);

const desktopCommandHost = read("apps/desktop/src/runtime/desktop-command-host.mjs");
assert(
  desktopCommandHost.includes('[DesktopRuntimeCommands.STATUS_ROOM]: ["statusRoom", "status"]'),
  "Desktop status command must prefer room-aware status so invite provisioning can finish after runtime readiness"
);
assert(
  desktopCommandHost.includes("SEND_SERVER_COMMAND") &&
    desktopCommandHost.includes("validateConsoleCommand"),
  "Desktop command host must expose a one-line server console command route"
);
assert(
  desktopCommandHost.includes("sanitizeCommandResult") &&
    desktopCommandHost.includes("Desktop command request contains unsupported fields."),
  "Desktop command host must validate renderer requests and sanitize controller DTOs"
);

const desktopAppScript = read("apps/desktop/app.js");
assert(
  desktopAppScript.includes("roomState.metrics") &&
    desktopAppScript.includes("전체 PC") &&
    !desktopAppScript.includes("function activityLevel"),
  "Desktop dashboard metrics must render runtime process metrics instead of synthetic activity levels"
);
assert(
  desktopAppScript.includes("bridgeResultSucceeded") &&
    desktopAppScript.includes('type: "bridge:result", command'),
  "Desktop console command submission must treat blocked bridge DTOs as failed commands instead of clearing input"
);
assert(
  desktopAppScript.includes("listenRuntimeEvents") &&
    desktopAppScript.includes('type: "runtime:event"'),
  "Desktop console must subscribe to runtime event streaming instead of waiting only for status polling"
);
assert(
  desktopAppScript.includes("function canUseConsoleCommandInput") &&
    desktopAppScript.includes("consoleCommandInput.disabled = !canUse") &&
    desktopAppScript.includes('roomState.commandPending === "server-command" ? "전송 중" : "전송"'),
  "Desktop console input must stay editable while a command is pending and only lock the send action"
);
assert(
  desktopAppScript.includes("consoleCommandComposing") &&
    desktopAppScript.includes("compositionstart") &&
    desktopAppScript.includes("compositionend"),
  "Desktop console input must avoid submitting unfinished Korean IME composition text"
);
assert(
  desktopAppScript.includes('consoleCommandInput.value = ""') &&
    desktopAppScript.includes('type: "console:append"') &&
    desktopAppScript.includes("`[입력] ${command}`"),
  "Desktop console command submission must echo immediately and clear the prompt before the bridge round-trip completes"
);
assert(
  desktopAppScript.includes("function isRoomOperationPending") &&
    desktopAppScript.includes('roomState.commandPending !== "server-command"') &&
    !desktopAppScript.includes('pending === "server-command") {\r\n    return "명령 전송 중"') &&
    !desktopAppScript.includes('pending === "server-command") {\n    return "명령 전송 중"'),
  "Desktop console command pending state must not make the global room header feel busy"
);
assert(
  desktopAppScript.includes("consoleTerminal?.addEventListener(\"click\"") &&
    desktopAppScript.includes("consoleCommandInput.focus()"),
  "Desktop terminal clicks must focus the embedded console prompt"
);
assert(
  desktopAppScript.includes("consoleAutoScroll") &&
    desktopAppScript.includes("function isConsoleScrolledNearBottom") &&
    desktopAppScript.includes("consoleOutput?.addEventListener(\"scroll\""),
  "Desktop console must not force-scroll when the user has scrolled away from the latest logs"
);
assert(
  desktopAppScript.includes("roomStateModel.isShareableInviteLink(link)") &&
    desktopStateScript.includes("function isShareableInviteLink") &&
    desktopStateScript.includes('host.endsWith(".local")') &&
    desktopStateScript.includes('host.endsWith(".test")') &&
    desktopStateScript.includes("isPrivateIpv4") &&
    desktopStateScript.includes("isPrivateIpv6"),
  "Desktop invite copy must distinguish development URLs from public shareable HTTPS links"
);

const nodeLocalRuntime = read("apps/desktop/src/runtime/node-local-runtime.mjs");
assert(
  nodeLocalRuntime.includes("writeServerCommand(processRef.stdin") &&
    nodeLocalRuntime.includes("stdin.write(commandLine") &&
    nodeLocalRuntime.includes("SERVER_COMMAND_WRITE_FAILED"),
  "Server console commands must wait for stdin write completion and surface write failures"
);
assert(
  nodeLocalRuntime.includes('trimmed.startsWith("/")') &&
    nodeLocalRuntime.includes("command: consoleCommand"),
  "Server console commands must accept player-style leading slash input but write console-style commands"
);
assert(
  nodeLocalRuntime.includes("Get-Process -Id") &&
    nodeLocalRuntime.includes("processCpuPercentFromSampleDelta") &&
    nodeLocalRuntime.includes("previousSample: lastProcessMetricsSample"),
  "Windows process metrics must use fast Get-Process sampling and compute CPU from sample deltas"
);
assert(
  nodeLocalRuntime.includes("allowSlowWindowsCim") &&
    nodeLocalRuntime.indexOf("readWindowsGetProcessResourceMetrics") <
      nodeLocalRuntime.indexOf("readWindowsCimProcessResourceMetrics"),
  "Slow Windows CIM process metrics must remain an opt-in fallback behind the fast Get-Process path"
);
assert(
  nodeLocalRuntime.includes("sha256File(source)") &&
    nodeLocalRuntime.includes("MOD_CHECKSUM_MISMATCH"),
  "Mod materialization must verify actual source bytes against the pinned SHA-256 before copying"
);
assert(
  nodeLocalRuntime.includes("verifyManagedPath") &&
    nodeLocalRuntime.includes("findExistingSymlinkSegment"),
  "Local runtime file writes must reject symlink/junction escapes from the managed app data root"
);
assert(
  nodeLocalRuntime.includes("isDangerousServerCommand") &&
    nodeLocalRuntime.includes('"whitelist"'),
  "Raw server console commands must block dangerous Minecraft admin commands"
);

const commandHostProcess = read("apps/desktop/src/runtime/desktop-command-host-process.mjs");
assert(
  commandHostProcess.includes("createDesktopRuntimeBridge") &&
    commandHostProcess.includes("createControlPlaneBoundaryAdapter") &&
    commandHostProcess.includes("createDesktopRoomController") &&
    commandHostProcess.includes("runDesktopCommandHostProcess") &&
    commandHostProcess.includes("desktop_runtime_event") &&
    commandHostProcess.includes("onRuntimeEvent"),
  "Desktop command host process must use the control-plane boundary adapter and room controller for invite provisioning, and stream runtime events for this dev bridge"
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

const missingInviteDom = createInviteDomSandbox("");
runInNewContext(inviteScript, missingInviteDom);
assert(missingInviteDom.elements.title.textContent === "초대를 찾을 수 없습니다", "Invite helper must fail closed without an invite handle");
assert(missingInviteDom.elements.roomFacts.hidden === true, "Invite helper must hide room facts without an invite handle");

const stateOnlyValidDom = createInviteDomSandbox("?state=valid");
runInNewContext(inviteScript, stateOnlyValidDom);
assert(stateOnlyValidDom.elements.title.textContent === "초대를 찾을 수 없습니다", "Invite helper must not trust valid state without an invite handle");
assert(stateOnlyValidDom.elements.roomFacts.hidden === true, "Invite helper must not show room facts without an invite handle");

const expectedInviteStates = {
  valid: { title: "초대 확인 중", hidden: true, actions: 1 },
  checking: { title: "초대 확인 중", hidden: true, actions: 1 },
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
  pending: { title: "초대 확인 중", hidden: true, actions: 1 },
  unavailable: { title: "초대를 열 수 없습니다", hidden: true, actions: 1 }
};

for (const [state, expected] of Object.entries(expectedInviteStates)) {
  const stateDom = createInviteDomSandbox(`?state=${state}&invite=invite_handle_static`);
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
checkScript("apps/desktop/dev-hot-reload.js");
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
