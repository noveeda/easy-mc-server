import { test } from "node:test";
import assert from "node:assert/strict";
import { HostRuntimeFailureReasons } from "../src/runtime/host-runtime.mjs";
import {
  createWindowsJavaCandidates,
  detectWindowsJava,
  parseJavaVersionOutput
} from "../src/runtime/node-java-detection.mjs";

test("node Java detection accepts Java 21 from JAVA_HOME", async () => {
  const calls = [];
  const result = await detectWindowsJava({
    env: {
      JAVA_HOME: "C:/Program Files/Eclipse Adoptium/jdk-21.0.6+7",
      PATH: ""
    },
    programFilesRoots: [],
    execFile: async (command, args) => {
      calls.push([command, args]);
      return {
        stdout: "",
        stderr: 'openjdk version "21.0.6" 2025-01-21 LTS\nOpenJDK Runtime Environment Temurin-21.0.6+7'
      };
    }
  });

  assert.deepEqual(result, {
    ok: true,
    java: {
      path: "C:/Program Files/Eclipse Adoptium/jdk-21.0.6+7/bin/java.exe",
      majorVersion: 21,
      version: "21.0.6",
      vendor: null,
      source: "JAVA_HOME"
    }
  });
  assert.deepEqual(calls, [
    ["C:/Program Files/Eclipse Adoptium/jdk-21.0.6+7/bin/java.exe", ["-version"]]
  ]);
});

test("node Java detection rejects Java 17 as incompatible", async () => {
  const result = await detectWindowsJava({
    configuredPath: "C:/Java/jdk-17/bin/java.exe",
    env: { PATH: "" },
    programFilesRoots: [],
    execFile: async () => ({
      stdout: "",
      stderr: 'java version "17.0.12" 2024-07-16 LTS'
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, HostRuntimeFailureReasons.JAVA_INCOMPATIBLE);
  assert.equal(result.failure.message, "Update Java before opening this room.");
  assert.deepEqual(result.failure.detail, {
    path: "C:/Java/jdk-17/bin/java.exe",
    majorVersion: 17,
    minimumMajorVersion: 21,
    source: "configuredPath"
  });
});

test("node Java detection returns missing when no candidates are available", async () => {
  let execCalls = 0;
  const result = await detectWindowsJava({
    env: { JAVA_HOME: "", PATH: "" },
    programFilesRoots: [],
    execFile: async () => {
      execCalls += 1;
      return {
        stdout: "",
        stderr: 'openjdk version "21.0.6"'
      };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, HostRuntimeFailureReasons.JAVA_MISSING);
  assert.equal(result.failure.message, "Install Java 21 or newer before opening this room.");
  assert.deepEqual(result.failure.detail, {
    minimumMajorVersion: 21,
    searchedCandidates: []
  });
  assert.equal(execCalls, 0);
});

test("node Java detection returns missing when probes fail", async () => {
  const result = await detectWindowsJava({
    configuredPath: "C:/Java/jdk-21/bin/java.exe",
    env: { PATH: "" },
    programFilesRoots: [],
    execFile: async () => {
      throw Object.assign(new Error("ENOENT"), {
        stdout: "",
        stderr: ""
      });
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, HostRuntimeFailureReasons.JAVA_MISSING);
  assert.deepEqual(result.failure.detail, {
    minimumMajorVersion: 21,
    searchedCandidates: ["C:/Java/jdk-21/bin/java.exe"]
  });
});

test("node Java detection reads Windows Path casing and probes PATH candidates when allowed", async () => {
  const calls = [];
  const result = await detectWindowsJava({
    env: {
      Path: "C:/Tools/Java/bin;;C:/Other/bin"
    },
    programFilesRoots: [],
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === "C:/Tools/Java/bin/java.exe") {
        return {
          stdout: "",
          stderr: 'openjdk version "21.0.6"'
        };
      }
      throw new Error("unexpected candidate");
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.java.path, "C:/Tools/Java/bin/java.exe");
  assert.equal(result.java.source, "PATH");
  assert.deepEqual(calls, [
    ["C:/Tools/Java/bin/java.exe", ["-version"]]
  ]);
});

test("node Java detection can exclude PATH and network candidates for real launch", async () => {
  let execCalls = 0;
  const result = await detectWindowsJava({
    env: {
      Path: "C:/UserWritable/bin",
      JAVA_HOME: "\\\\server\\share\\jdk"
    },
    programFilesRoots: [],
    allowPathCandidates: false,
    execFile: async () => {
      execCalls += 1;
      return {
        stdout: "",
        stderr: 'openjdk version "21.0.6"'
      };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, HostRuntimeFailureReasons.JAVA_MISSING);
  assert.deepEqual(result.failure.detail.searchedCandidates, []);
  assert.equal(execCalls, 0);
});

test("node Java candidate generation deduplicates candidates and ignores empty or unsafe paths", async () => {
  const candidates = await createWindowsJavaCandidates({
    configuredPath: "  C:/Java/jdk-21/bin/java.exe  ",
    env: {
      JAVA_HOME: "C:/Java/jdk-21",
      PATH: "C:/Java/jdk-21/bin;;../relative;C:/Java/jdk-17/bin;C:/Java/jdk-17/bin"
    },
    pathCandidates: [
      "",
      "C:/Java/jdk-21/bin",
      "C:/Java/jdk-17/bin",
      "C:/Java/jdk-17/bin",
      "C:/bad/../jdk/bin",
      "relative/bin",
      "C:/bad\u0000/bin"
    ],
    programFilesRoots: ["C:/Program Files"],
    readdir: async (path) => path === "C:/Program Files/Eclipse Adoptium"
      ? ["jdk-21.0.6+7", "..", "bad/name"]
      : [],
    exists: async (path) => path === "C:/Program Files/Eclipse Adoptium/jdk-21.0.6+7/bin/java.exe"
  });

  assert.deepEqual(candidates, [
    {
      path: "C:/Java/jdk-21/bin/java.exe",
      source: "configuredPath",
      vendor: null
    },
    {
      path: "C:/Java/jdk-17/bin/java.exe",
      source: "PATH",
      vendor: null
    },
    {
      path: "C:/Program Files/Eclipse Adoptium/jdk-21.0.6+7/bin/java.exe",
      source: "ProgramFiles/Eclipse Adoptium",
      vendor: "Eclipse Adoptium"
    }
  ]);
});

test("Java version parser supports modern and legacy version formats", () => {
  assert.deepEqual(parseJavaVersionOutput('openjdk version "21.0.6" 2025-01-21'), {
    version: "21.0.6",
    majorVersion: 21
  });
  assert.deepEqual(parseJavaVersionOutput('java version "1.8.0_402"'), {
    version: "1.8.0_402",
    majorVersion: 8
  });
  assert.deepEqual(parseJavaVersionOutput("not java"), null);
});
