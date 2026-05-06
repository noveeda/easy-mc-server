const MODRINTH_CDN_HOST = "cdn.modrinth.com";

export const DesktopCuratedCatalog = Object.freeze({
  "performance-core": Object.freeze({
    id: "performance-core",
    title: "가벼운 친구 방",
    summary: "서버와 친구 클라이언트에 모두 안전한 기본 성능 구성입니다.",
    modIds: Object.freeze(["fabric-api", "lithium", "ferritecore"])
  }),
  "fabric-api": Object.freeze({
    id: "fabric-api",
    title: "Fabric API",
    summary: "대부분의 Fabric 모드가 필요로 하는 기본 모드입니다.",
    modIds: Object.freeze(["fabric-api"])
  }),
  "lithium": Object.freeze({
    id: "lithium",
    title: "Lithium",
    summary: "서버 연산 성능을 개선하는 인기 모드입니다.",
    modIds: Object.freeze(["fabric-api", "lithium"])
  }),
  "ferritecore": Object.freeze({
    id: "ferritecore",
    title: "FerriteCore",
    summary: "서버와 클라이언트의 메모리 사용량을 줄이는 추천 모드입니다.",
    modIds: Object.freeze(["fabric-api", "ferritecore"])
  })
});

const catalogMods = Object.freeze({
  "fabric-api": Object.freeze({
    id: "fabric-api",
    title: "Fabric API",
    fileName: "fabric-api-0.116.11-1.21.1.jar",
    sourceFileName: "fabric-api-0.116.11+1.21.1.jar",
    sha256: "b791de6f6dce9c58d4ea2af6c713bbcc6dc64d0a5995a8bad6f225ee58cf17d2",
    fileSize: 2426356,
    downloadUrl: "https://cdn.modrinth.com/data/P7dR8mSH/versions/IpaMcBLh/fabric-api-0.116.11%2B1.21.1.jar",
    side: Object.freeze({ client: "required", server: "required" })
  }),
  lithium: Object.freeze({
    id: "lithium",
    title: "Lithium",
    fileName: "lithium-fabric-0.15.3-mc1.21.1.jar",
    sourceFileName: "lithium-fabric-0.15.3+mc1.21.1.jar",
    sha256: "a1eb3b150b559b0c0976f628ffd5f791458b98891634211b2727ff7857d157b8",
    fileSize: 797398,
    downloadUrl: "https://cdn.modrinth.com/data/gvQqBUqZ/versions/XQJtuOTA/lithium-fabric-0.15.3%2Bmc1.21.1.jar",
    side: Object.freeze({ client: "unsupported", server: "required" })
  }),
  ferritecore: Object.freeze({
    id: "ferritecore",
    title: "FerriteCore",
    fileName: "ferritecore-7.0.3-fabric.jar",
    sourceFileName: "ferritecore-7.0.3-fabric.jar",
    sha256: "98c3ab1d5aab8f14b5d082d3f1a467727fd335f02d124555c94339761c4c18f2",
    fileSize: 123450,
    downloadUrl: "https://cdn.modrinth.com/data/uXXizFIs/versions/sOzRw3CG/ferritecore-7.0.3-fabric.jar",
    side: Object.freeze({ client: "required", server: "required" })
  })
});

export function createDesktopCuratedPackMods({ selectionId = "performance-core", downloadsDirectory } = {}) {
  const selection = DesktopCuratedCatalog[selectionId] ?? DesktopCuratedCatalog["performance-core"];

  return selection.modIds.map((modId) => {
    const mod = catalogMods[modId];
    const sourceFileName = mod.sourceFileName ?? mod.fileName;
    return {
      id: mod.id,
      title: mod.title,
      fileName: mod.fileName,
      sourceFileName,
      source: downloadsDirectory ? joinPath(downloadsDirectory, sourceFileName) : undefined,
      sha256: mod.sha256,
      expectedSha256: mod.sha256,
      fileSize: mod.fileSize,
      downloadUrl: mod.downloadUrl,
      provider: "Modrinth",
      side: { ...mod.side }
    };
  });
}

export function validateCuratedModDownloadUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === MODRINTH_CDN_HOST
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^([A-Z]):\//i, "$1:/");
}
