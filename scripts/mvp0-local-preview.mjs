import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HostRuntimeStates, createHostRuntimePlan } from "../apps/desktop/src/runtime/host-runtime.mjs";
import { bootstrapFabricServer } from "../apps/desktop/src/runtime/node-fabric-bootstrap.mjs";
import { NodeJavaDetectionSources, detectWindowsJava } from "../apps/desktop/src/runtime/node-java-detection.mjs";
import { launchLocalServer, materializeRoom } from "../apps/desktop/src/runtime/node-local-runtime.mjs";
import { readMrpackTemplate, validateMrpackTemplate } from "../packages/modpack-builder/src/mrpack.mjs";
import {
  createFriendOpenFrame,
  startLocalTcpRelayPreview,
  startTcpEchoTarget
} from "../services/relay/src/local-tcp-relay-preview.mjs";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url))).replaceAll("\\", "/");
const previewRoot = `${workspaceRoot}/.local/mvp0-preview`;
const templatePath = `${workspaceRoot}/packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json`;
const smokeTimeoutMs = 5000;

if (isDirectExecution()) {
  runMvp0Preview({
    realLaunch: process.argv.includes("--real-launch"),
    downloadFabric: process.argv.includes("--download-fabric")
  }).catch((error) => {
    console.error("");
    console.error("MVP-0 로컬 preview 실행 중 예상하지 못한 오류가 발생했습니다.");
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}

export async function runMvp0Preview({ realLaunch = false, downloadFabric = false, detectJava = detectWindowsJava, fetch = globalThis.fetch } = {}) {
  section("0/7 MVP-0 로컬 runnable preview를 시작합니다.");
  line(`작업 폴더: ${previewRoot}`);
  line(`실행 모드: ${realLaunch ? "실제 Java/Fabric 실행 요청" : "dry-run (기본값)"}`);
  line(`Fabric 다운로드: ${downloadFabric ? "요청됨" : "생략"}`);

  await preparePreviewRoot();

  const runtimePlan = await createPreviewRuntimePlan();
  await runMaterialization(runtimePlan);
  const packStatus = await runPackReadinessCheck();
  const bootstrapStatus = await runRuntimeBootstrapCheck(runtimePlan, { realLaunch, downloadFabric, detectJava, fetch });
  const launchStatus = await runLaunchPreview(bootstrapStatus.runtimePlan, { realLaunch });
  const relayStatus = await runRelaySmoke();

  section("Preview 결과");
  line("방 파일 materialize: 완료");
  line(`Pack template readiness: ${packStatus.summary}`);
  line(`Runtime bootstrap: ${bootstrapStatus.summary}`);
  line(`Java/Fabric launch path: ${launchStatus.summary}`);
  line(`로컬 TCP relay smoke: ${relayStatus.summary}`);
  line("이 preview는 외부 다운로드 없이 실행되는 개발자용 경로입니다.");

  return {
    previewRoot,
    packStatus,
    bootstrapStatus,
    launchStatus,
    relayStatus
  };
}

async function preparePreviewRoot() {
  section("1/7 preview 작업 폴더를 준비합니다.");
  await rm(previewRoot, { recursive: true, force: true });
  await mkdir(`${previewRoot}/cache/downloads`, { recursive: true });
  line(".local/mvp0-preview를 새로 만들었습니다.");
}

async function createPreviewRuntimePlan() {
  section("2/7 고정 방 실행 계획을 만듭니다.");

  const mods = [
    {
      id: "fabric-api",
      fileName: "fabric-api-0.116.11-1.21.1.jar",
      sha256: "preview-fabric-api-sha256"
    },
    {
      id: "lithium",
      fileName: "lithium-fabric-0.15.3-mc1.21.1.jar",
      sha256: "preview-lithium-sha256"
    },
    {
      id: "ferritecore",
      fileName: "ferritecore-7.0.3-fabric.jar",
      sha256: "preview-ferritecore-sha256"
    }
  ];

  for (const mod of mods) {
    const source = `${previewRoot}/cache/downloads/${mod.fileName}`;
    const contents = `MVP-0 local preview placeholder for ${mod.id}\n`;
    await writeFile(source, contents, "utf8");
    mod.source = source;
    mod.sha256 = createHash("sha256").update(contents).digest("hex");
  }

  const runtime = createHostRuntimePlan({
    room: {
      id: "mvp0-room",
      hostId: "preview-host",
      name: "MVP-0 Preview Room",
      appDataRoot: previewRoot
    },
    minecraft: {
      version: "1.21.1",
      supportedVersions: [{ version: "1.21.1", channel: "stable", javaMajor: 21 }]
    },
    java: {
      path: `${previewRoot}/runtime/java/bin/java.exe`,
      majorVersion: 21,
      source: "preview-placeholder"
    },
    fabric: {
      loaderVersion: "0.19.2",
      expectedInstallerSha256: "preview-fabric-installer-sha256",
      installerSha256: "preview-fabric-installer-sha256",
      loaders: [
        {
          minecraftVersion: "1.21.1",
          version: "0.19.2",
          launcherJar: "fabric-server-1.21.1-0.19.2.jar",
          installerSha256: "preview-fabric-installer-sha256",
          serverJarSha256: "preview-fabric-server-sha256"
        }
      ]
    },
    cache: { reuseVerifiedDownloads: true },
    eula: { accepted: true },
    serverProperties: { maxPlayers: 10, motd: "MVP-0 Preview Room", port: 25565 },
    pack: {
      id: "mvp0-performance-room-1.21.1",
      fixed: true,
      expectedSha256: "preview-pack-sha256",
      sha256: "preview-pack-sha256",
      mods: mods.map((mod) => ({
        id: mod.id,
        fileName: mod.fileName,
        sha256: mod.sha256,
        expectedSha256: mod.sha256,
        source: mod.source
      }))
    },
    runtime: { state: HostRuntimeStates.STOPPED }
  });

  if (!runtime.ok) {
    throw new Error(`방 실행 계획 생성 실패: ${runtime.failure.message}`);
  }

  line("Minecraft 1.21.1 / Fabric Loader 0.19.2 / fixed pack 입력을 준비했습니다.");
  line("외부 다운로드 대신 preview placeholder 파일을 로컬 cache에 만들었습니다.");
  return runtime.plan;
}

async function runMaterialization(runtimePlan) {
  section("3/7 방 파일을 materialize합니다.");
  const result = await materializeRoom(runtimePlan);

  if (!result.ok) {
    throw new Error(`방 파일 생성 실패: ${result.failure.message}`);
  }

  line(`방 루트: ${result.root}`);
  line(`생성/갱신 파일: ${result.writtenFiles.length}개`);
  line(`보존 파일: ${result.preservedFiles.length}개`);
  line(`복사된 고정팩 파일: ${result.copiedMods.length}개`);
}

async function runPackReadinessCheck() {
  section("4/7 pack template readiness를 검사합니다.");
  const template = await readMrpackTemplate(templatePath);
  const readiness = validateMrpackTemplate(template);

  if (readiness.ok) {
    line(".mrpack 생성 가능: 모든 metadata가 준비되었습니다.");
    return { state: "ready", summary: "ready" };
  }

  line(".mrpack 생성 상태: blocked");
  const firstPartyBlockers = readiness.blockers.filter((blocker) => blocker.reason === "first_party_artifact_pending");
  if (firstPartyBlockers.length > 0) {
    for (const blocker of firstPartyBlockers) {
      line(`first-party artifact placeholder: ${blocker.path}`);
    }
    line("서명된 first-party client mod artifact의 HTTPS URL, SHA1, SHA512, fileSize가 필요합니다.");
  } else {
    for (const blocker of readiness.blockers) {
      line(`${blocker.path}: ${blocker.message}`);
    }
  }

  return {
    state: "blocked",
    summary: "blocked (first-party artifact placeholder가 남아 있음)"
  };
}

async function runRuntimeBootstrapCheck(runtimePlan, { realLaunch = false, downloadFabric = false, detectJava, fetch } = {}) {
  section("5/7 Java/Fabric bootstrap adapter를 확인합니다.");

  if (!realLaunch && !downloadFabric) {
    line("dry-run: 실제 Java 감지와 Fabric 다운로드는 실행하지 않습니다.");
    return {
      state: "skipped",
      summary: "skipped (dry-run)",
      runtimePlan
    };
  }

  const javaResult = await detectJava({
    configuredPath: runtimePlan.java?.path,
    minimumMajorVersion: runtimePlan.java?.minimumMajorVersion ?? 21,
    allowPathCandidates: false,
    allowNetworkPaths: false,
    trustedSources: [
      NodeJavaDetectionSources.CONFIGURED_PATH,
      NodeJavaDetectionSources.JAVA_HOME,
      NodeJavaDetectionSources.ADOPTIUM,
      NodeJavaDetectionSources.JAVA
    ]
  });

  if (!javaResult.ok) {
    line(`Java 감지: blocked - ${javaResult.failure.message}`);
    return {
      state: "blocked",
      summary: `blocked (${javaResult.failure.message})`,
      runtimePlan
    };
  }

  line(`Java 감지: Java ${javaResult.java.majorVersion} (${javaResult.java.source})`);
  const nextRuntimePlan = withDetectedJava(runtimePlan, javaResult.java);

  if (!downloadFabric) {
    line("Fabric 다운로드: 생략 (--download-fabric 옵션이 있을 때만 다운로드 시도)");
    return {
      state: "java-ready",
      summary: "Java 감지 완료, Fabric 다운로드 생략",
      runtimePlan: nextRuntimePlan,
      java: javaResult.java
    };
  }

  const fabricResult = await bootstrapFabricServer(nextRuntimePlan, { fetch });
  if (!fabricResult.ok) {
    line(`Fabric bootstrap: blocked - ${fabricResult.failure.message}`);
    return {
      state: "blocked",
      summary: `blocked (${fabricResult.failure.message})`,
      runtimePlan: nextRuntimePlan,
      java: javaResult.java,
      fabricFailure: fabricResult.failure
    };
  }

  line(`Fabric bootstrap: 검증된 server jar 설치 완료 (${fabricResult.sha256})`);
  return {
    state: "ready",
    summary: "Java 감지 및 Fabric server jar 검증 완료",
    runtimePlan: nextRuntimePlan,
    java: javaResult.java,
    fabric: fabricResult
  };
}

async function runLaunchPreview(runtimePlan, { realLaunch = false } = {}) {
  section("6/7 Java/Fabric 서버 실행 경로를 확인합니다.");
  const result = await launchLocalServer(runtimePlan, { mode: realLaunch ? "real" : "dry-run" });

  if (result.ok && result.launched === false) {
    line("dry-run 완료: 실제 Java 프로세스는 시작하지 않았습니다.");
    line(`실행 intent: ${result.intent.command} ${result.intent.args.join(" ")}`);
    return { state: "dry-run", summary: "dry-run 완료" };
  }

  if (result.ok && result.launched === true) {
    line("실제 Java/Fabric 프로세스를 시작했습니다.");
    return { state: "launched", summary: "실제 프로세스 시작" };
  }

  if (realLaunch && result.failure?.reason === "runtime_artifact_missing") {
    line("실제 실행 불가: 필요한 로컬 artifact가 없습니다.");
    for (const missing of result.failure.detail.missing ?? []) {
      line(missingArtifactLabel(missing));
    }
    line("이 상태는 preview 실패가 아니라 현재 저장소의 외부 artifact blocker입니다.");
    return {
      state: "blocked",
      summary: "blocked (Fabric server jar 또는 Java runtime 같은 외부 artifact가 없음)",
      missing: result.failure.detail.missing ?? []
    };
  }

  throw new Error(`서버 실행 경로 확인 실패: ${result.failure?.message ?? "unknown failure"}`);
}

async function runRelaySmoke() {
  section("7/7 로컬 TCP relay preview smoke를 실행합니다.");
  const hostTarget = await startTcpEchoTarget({ responsePrefix: "host:" });
  const relay = await startLocalTcpRelayPreview({
    sessions: [
      {
        sessionId: "preview-session",
        roomId: "mvp0-room",
        minecraftUuid: "preview-friend-uuid",
        target: {
          host: hostTarget.host,
          port: hostTarget.port
        }
      }
    ]
  });

  try {
    const socket = createConnection({ host: relay.host, port: relay.port });
    await waitForEvent(socket, "connect", "relay listener 연결 시간 초과");
    socket.write(createFriendOpenFrame({
      roomId: "mvp0-room",
      sessionId: "preview-session",
      minecraftUuid: "preview-friend-uuid",
      requestedTarget: {
        host: hostTarget.host,
        port: hostTarget.port
      }
    }));
    socket.write("ping");

    const [response] = await waitForEvent(socket, "data", "relay smoke 응답 대기 시간 초과");
    socket.destroy();

    if (response.toString("utf8") !== "host:ping") {
      throw new Error(`relay smoke 응답이 예상과 다릅니다: ${response.toString("utf8")}`);
    }

    line(`relay listener: ${relay.host}:${relay.port}`);
    line(`host target: ${hostTarget.host}:${hostTarget.port}`);
    line("friend payload가 relay를 통해 host target까지 왕복했습니다.");
    return { state: "passed", summary: "완료" };
  } finally {
    await relay.close();
    await hostTarget.close();
  }
}

function waitForEvent(emitter, eventName, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${timeoutMessage} (${smokeTimeoutMs}ms)`));
    }, smokeTimeoutMs);
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      emitter.off("error", onError);
    };

    emitter.once(eventName, onEvent);
    emitter.once("error", onError);
  });
}

function missingArtifactLabel(missing) {
  const labels = {
    room_root: "방 폴더",
    fabric_server_jar: "Fabric server launcher jar",
    java_runtime: "Java 21 runtime"
  };
  return labels[missing] ?? missing;
}

function withDetectedJava(runtimePlan, java) {
  const next = structuredCloneJson(runtimePlan);
  next.java.path = java.path;
  next.java.majorVersion = java.majorVersion;
  next.java.source = java.source;
  next.java.vendor = java.vendor;
  next.command[0] = java.path;
  return next;
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function section(message) {
  console.log("");
  console.log(`== ${message}`);
}

function line(message) {
  console.log(`- ${message}`);
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
