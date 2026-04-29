(function attachRoomDesktopState(global) {
  const fakeInvite = "https://room.example/invite/COZY-2719";
  const initialRoomState = Object.freeze({
    prepared: false,
    open: false,
    inviteLink: null,
    request: "pending"
  });

  function cloneInitialState() {
    return { ...initialRoomState };
  }

  function reduceRoomState(state, action) {
    switch (action.type) {
      case "prepare":
        return {
          ...state,
          prepared: true,
          open: false,
          inviteLink: null
        };
      case "open":
        if (!state.prepared) {
          return state;
        }

        return {
          ...state,
          open: true,
          inviteLink: fakeInvite
        };
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

  global.RoomDesktopState = {
    fakeInvite,
    initialRoomState,
    cloneInitialState,
    reduceRoomState
  };
})(typeof window !== "undefined" ? window : globalThis);
