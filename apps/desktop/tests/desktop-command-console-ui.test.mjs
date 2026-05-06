import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const root = resolve(".");

test("desktop console submit echoes immediately and forwards the command", async () => {
  const harness = createDesktopAppHarness();
  harness.emitRuntimeEvent({ type: "runtime.ready" });

  const input = harness.element("console-command-input");
  const output = harness.element("console-output");
  input.value = "say hello world";
  input.dispatchEvent(event("input"));

  const submitResults = harness.element("console-command-form").dispatchEvent(event("submit"));

  assert.equal(input.value, "", "console prompt should clear before the bridge command resolves");
  assert.deepEqual(harness.sentCommands, [{ command: "say hello world" }]);
  assert.match(output.textContent, /\[입력\] say hello world/);

  harness.resolveCommand({
    state: "running",
    summary: "Server command sent.",
    events: []
  });
  await Promise.all(submitResults);
});

test("desktop console keeps scroll position when the user is reading older logs", () => {
  const harness = createDesktopAppHarness();
  const output = harness.element("console-output");
  output.scrollHeight = 1000;
  output.clientHeight = 100;

  harness.emitRuntimeEvent({ type: "runtime.ready" });
  output.scrollTop = 200;
  output.dispatchEvent(event("scroll"));

  harness.emitRuntimeEvent({
    type: "runtime.log",
    stream: "stdout",
    line: "[Server thread/INFO]: hello while reading history"
  });

  assert.equal(output.scrollTop, 200, "new logs must not force-scroll when the user is above the bottom");
  assert.match(output.textContent, /hello while reading history/);
});

test("desktop catalog selection is included in the room pack request", async () => {
  const harness = createDesktopAppHarness();
  const catalogSelect = harness.element("catalog-mod-select");

  catalogSelect.value = "lithium";
  catalogSelect.dispatchEvent(event("change"));

  harness.element("prepare-room-button").dispatchEvent(event("click"));
  await flushAsync();

  assert.deepEqual(harness.prepareRequests, [
    { minecraftVersion: "1.21.1", pack: "performance", catalogModId: "lithium" }
  ]);
  assert.match(
    harness.element("catalog-server-applicability").textContent,
    /서버 적용/
  );
});

function createDesktopAppHarness() {
  const stateSandbox = {};
  runInNewContext(read("apps/desktop/state.js"), stateSandbox);

  const document = createDesktopDocument();
  const sentCommands = [];
  const prepareRequests = [];
  const openRequests = [];
  const pendingCommands = [];
  let runtimeListener = null;

  const roomBridge = {
    isDesktopRuntimeAvailable: () => true,
    prepareRoom: async (request) => {
      prepareRequests.push({ ...request });
      return { state: "ready", prepared: true };
    },
    openRoom: async (request) => {
      openRequests.push({ ...request });
      return { state: "running" };
    },
    closeRoom: async () => ({ state: "stopped" }),
    restartRoom: async () => ({ state: "running" }),
    statusRoom: async () => ({ state: "running", events: [] }),
    resetRoom: async () => ({ state: "idle" }),
    sendServerCommand(request) {
      sentCommands.push({ ...request });
      return new Promise((resolve) => {
        pendingCommands.push(resolve);
      });
    },
    listenRuntimeEvents(listener) {
      runtimeListener = listener;
      return Promise.resolve(() => {});
    }
  };

  runInNewContext(read("apps/desktop/app.js"), {
    window: {
      RoomDesktopState: stateSandbox.RoomDesktopState,
      RoomDesktopBridge: roomBridge
    },
    document,
    setInterval: () => 1,
    clearInterval: () => {},
    console
  });

  return {
    sentCommands,
    prepareRequests,
    openRequests,
    element(id) {
      return document.element(id);
    },
    emitRuntimeEvent(runtimeEvent) {
      assert(runtimeListener, "app should subscribe to runtime events");
      runtimeListener(runtimeEvent);
    },
    resolveCommand(result) {
      const resolveCommand = pendingCommands.shift();
      assert(resolveCommand, "expected a pending console command");
      resolveCommand(result);
    }
  };
}

function createDesktopDocument() {
  const elements = new Map();
  const tabLinks = [
    new FakeElement("dashboard-tab", { dataset: { tabTarget: "dashboard-view" } }),
    new FakeElement("console-tab", { dataset: { tabTarget: "console-view" } })
  ];
  const viewPanels = [
    new FakeElement("dashboard-view"),
    new FakeElement("console-view")
  ];

  for (const id of [
    "room-status",
    "runtime-pill",
    "version-select",
    "pack-select",
    "room-files-row",
    "prepare-room-button",
    "open-room-button",
    "close-room-button",
    "restart-room-button",
    "reset-button",
    "room-blocker",
    "blocker-title",
    "blocker-message",
    "runtime-rows",
    "diagnostics-rows",
    "cpu-metric",
    "ram-metric",
    "uptime-metric",
    "metric-basis",
    "chart-stack",
    "chart-empty-state",
    "cpu-chart",
    "ram-chart",
    "player-chart",
    "catalog-mod-select",
    "catalog-gate-pill",
    "catalog-mod-name",
    "catalog-mod-summary",
    "catalog-risk",
    "catalog-dependencies",
    "catalog-conflicts",
    "catalog-server-applicability",
    "catalog-gate-copy",
    "console-terminal",
    "console-output",
    "console-state-pill",
    "console-command-form",
    "console-command-input",
    "console-command-button"
  ]) {
    elements.set(id, new FakeElement(id));
  }

  elements.get("room-files-row").setQuerySelector(".readiness-title", new FakeElement("room-files-title"));
  elements.get("room-files-row").setQuerySelector(".readiness-text", new FakeElement("room-files-text"));
  elements.get("version-select").value = "1.21.1";
  elements.get("pack-select").value = "performance";

  return {
    element(id) {
      const element = elements.get(id);
      assert(element, `missing fake element: ${id}`);
      return element;
    },
    createElement(tagName) {
      return new FakeElement("", { tagName });
    },
    querySelector(selector) {
      if (!selector.startsWith("#")) {
        return null;
      }
      return elements.get(selector.slice(1)) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-tab-target]") {
        return tabLinks;
      }
      if (selector === ".view-panel") {
        return viewPanels;
      }
      return [];
    }
  };
}

class FakeElement {
  constructor(id = "", options = {}) {
    this.id = id;
    this.tagName = options.tagName ?? "div";
    this.dataset = options.dataset ?? {};
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.querySelectors = new Map();
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.focusCount = 0;
    this.style = {
      values: new Map(),
      setProperty: (name, value) => {
        this.style.values.set(name, value);
      }
    };
    this.classList = new FakeClassList();
  }

  get firstElementChild() {
    return this.children.find((child) => child instanceof FakeElement) ?? null;
  }

  setQuerySelector(selector, element) {
    this.querySelectors.set(selector, element);
  }

  querySelector(selector) {
    return this.querySelectors.get(selector) ?? null;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(eventObject) {
    const listeners = this.listeners.get(eventObject.type) ?? [];
    eventObject.target ??= this;
    eventObject.currentTarget = this;
    return listeners.map((listener) => listener(eventObject));
  }

  focus() {
    this.focusCount += 1;
  }
}

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
    if (enabled) {
      this.classes.add(name);
    } else {
      this.classes.delete(name);
    }
    return enabled;
  }

  contains(name) {
    return this.classes.has(name);
  }
}

function event(type) {
  return {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}
