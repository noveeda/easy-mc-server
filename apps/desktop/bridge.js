(function attachRoomDesktopBridge(global) {
  const fallbackDiagnostics = Object.freeze([
    ["Bridge", "static file preview"],
    ["Runtime", "not connected to Tauri commands"],
    ["Open room", "blocked outside the packaged desktop runtime"]
  ]);

  const fallbackRows = Object.freeze([
    ["방 파일", "미리보기용 준비가 끝났습니다."],
    ["방 상태", "데스크톱 실행 연결을 기다리는 중입니다."],
    ["초대", "방이 실제로 열린 뒤에만 만들 수 있습니다."]
  ]);
  const commands = Object.freeze({
    prepareRoom: "desktop_prepare_room",
    openRoom: "desktop_open_room",
    closeRoom: "desktop_close_room",
    restartRoom: "desktop_restart_room",
    resetRoom: "desktop_reset_room"
  });

  function getInvoke() {
    return global.__TAURI__?.core?.invoke;
  }

  async function invokeOrFallback(command, payload, fallback) {
    const invoke = getInvoke();
    if (typeof invoke === "function") {
      return invoke(command, { request: payload ?? {} });
    }

    return fallback(payload ?? {});
  }

  function readyResponse() {
    return {
      ok: true,
      status: "ready",
      prepared: true,
      open: false,
      previewOpen: false,
      inviteLink: null,
      message: "방 파일 준비가 끝났습니다.",
      runtimeRows: fallbackRows,
      diagnostics: fallbackDiagnostics
    };
  }

  function blockedOpenResponse() {
    return {
      ok: false,
      status: "blocked",
      prepared: true,
      open: false,
      previewOpen: false,
      inviteLink: null,
      blocker: {
        title: "방을 실제로 열 수 없습니다",
        message: "이 화면은 파일 미리보기라 실제 방을 시작하지 않습니다. 데스크톱 앱으로 실행하면 방 열기를 다시 시도할 수 있습니다."
      },
      runtimeRows: [
        ["방 파일", "준비됨"],
        ["방 상태", "미리보기에서는 열 수 없음"],
        ["다음 단계", "데스크톱 앱 연결 필요"]
      ],
      diagnostics: fallbackDiagnostics
    };
  }

  const bridge = {
    commands,
    prepareRoom(payload) {
      return invokeOrFallback(commands.prepareRoom, payload, readyResponse);
    },
    openRoom(payload) {
      return invokeOrFallback(commands.openRoom, payload, blockedOpenResponse);
    },
    closeRoom(payload) {
      return invokeOrFallback(commands.closeRoom, payload, () => ({
        ...readyResponse(),
        message: "미리보기 상태가 준비 완료로 돌아갔습니다."
      }));
    },
    restartRoom(payload) {
      return invokeOrFallback(commands.restartRoom, payload, blockedOpenResponse);
    },
    resetRoom(payload) {
      return invokeOrFallback(commands.resetRoom, payload, () => ({
        ok: true,
        status: "idle",
        prepared: false,
        open: false,
        previewOpen: false,
        inviteLink: null,
        runtimeRows: [],
        diagnostics: []
      }));
    }
  };

  global.RoomDesktopBridge = bridge;
})(typeof window !== "undefined" ? window : globalThis);
