export const CatalogProviders = Object.freeze({
  MODRINTH: "modrinth",
  CURSEFORGE: "curseforge",
  PRISM: "prism",
  LOCAL: "local"
});

export const MetadataStates = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE: "incomplete"
});

export const RecommendationStates = Object.freeze({
  READY: "ready",
  BLOCKED: "blocked"
});

export function normalizeModrinthVersion({ project, version, permission }) {
  if (!project || !version) {
    throw new TypeError("project and version metadata are required");
  }

  const projectId = version.project_id ?? project.id;
  const slug = project.slug ?? projectId;
  const side = normalizeSide(project.client_side, project.server_side);
  const files = normalizeFiles(version.files ?? []);
  const sourceUrl = project.source_url ?? project.sourceUrl ?? `https://modrinth.com/mod/${slug}`;

  const entry = {
    id: projectId,
    projectId,
    slug,
    title: project.title ?? slug,
    description: project.description ?? project.body ?? "",
    sourceUrl,
    source: {
      provider: CatalogProviders.MODRINTH,
      projectId,
      versionId: version.id,
      projectUrl: sourceUrl,
      versionUrl: `https://modrinth.com/mod/${slug}/version/${version.id}`
    },
    license: normalizeLicense(project.license),
    permission: permission ?? project.permission ?? project.permissions ?? defaultPermissionRecord(),
    side,
    version: {
      id: version.id,
      number: version.version_number,
      name: version.name ?? version.version_number,
      gameVersions: [...(version.game_versions ?? [])],
      loaders: [...(version.loaders ?? [])],
      dependencies: normalizeDependencies(version.dependencies ?? [])
    },
    files,
    metadataSource: CatalogProviders.MODRINTH
  };

  return {
    ...entry,
    metadataCompleteness: evaluateCatalogEntryMetadata(entry)
  };
}

export function createCuratedPack({ name, versionId, summary, minecraftVersion, fabricLoaderVersion, mods }) {
  if (!Array.isArray(mods) || mods.length === 0) {
    throw new TypeError("mods must include at least one normalized catalog entry");
  }

  const unsafeMods = mods.filter((mod) => !catalogEntryHasRequiredMetadata(mod));
  if (unsafeMods.length > 0) {
    throw new TypeError(`mods include entries with incomplete metadata: ${unsafeMods.map((mod) => mod.projectId ?? mod.id ?? "unknown").join(", ")}`);
  }

  return {
    formatVersion: 1,
    game: "minecraft",
    versionId,
    name,
    summary,
    files: mods.flatMap((mod) =>
      mod.files.map((file) => ({
        path: `mods/${file.filename}`,
        hashes: { ...file.hashes },
        env: sideToEnv(mod.side),
        downloads: [file.url],
        fileSize: file.size,
        metadata: {
          projectId: mod.projectId,
          sourceUrl: mod.sourceUrl,
          license: mod.license,
          permission: mod.permission
        }
      }))
    ),
    dependencies: {
      minecraft: minecraftVersion,
      "fabric-loader": fabricLoaderVersion
    }
  };
}

export function catalogEntryHasRequiredMetadata(entry) {
  return evaluateCatalogEntryMetadata(entry).complete;
}

export function evaluateCatalogEntryMetadata(entry) {
  const missing = [];
  const sourceProvider = entry?.source?.provider ?? entry?.metadataSource;
  const sourceUrl = entry?.sourceUrl ?? entry?.source?.projectUrl ?? entry?.source?.url;

  requireField(missing, "projectId", entry?.projectId ?? entry?.id, "Catalog entry must have a stable project id.");
  requireField(missing, "source.provider", sourceProvider, "Catalog entry must identify the source provider.");
  requireField(missing, "sourceUrl", sourceUrl, "Catalog entry must keep the original source URL.");
  requireField(missing, "license", entry?.license, "Catalog entry must include license metadata.");
  requireField(missing, "permission", entry?.permission, "Catalog entry must include redistribution permission metadata.");

  if (!hasCompleteSideMetadata(entry?.side)) {
    missing.push({
      field: "side",
      reason: "Catalog entry must include explicit client and server side support."
    });
  }

  if (!Array.isArray(entry?.version?.gameVersions) || entry.version.gameVersions.length === 0) {
    missing.push({
      field: "version.gameVersions",
      reason: "Catalog entry must list supported Minecraft versions."
    });
  }

  if (!Array.isArray(entry?.version?.loaders) || entry.version.loaders.length === 0) {
    missing.push({
      field: "version.loaders",
      reason: "Catalog entry must list supported loaders."
    });
  }

  if (!Array.isArray(entry?.version?.dependencies)) {
    missing.push({
      field: "version.dependencies",
      reason: "Catalog entry must include a dependency list, even when empty."
    });
  }

  if (!Array.isArray(entry?.files) || entry.files.length === 0) {
    missing.push({
      field: "files",
      reason: "Catalog entry must include at least one downloadable file."
    });
  } else {
    for (const [index, file] of entry.files.entries()) {
      if (!file?.filename) {
        missing.push({ field: `files[${index}].filename`, reason: "Catalog file must include a filename." });
      }
      if (!file?.url) {
        missing.push({ field: `files[${index}].url`, reason: "Catalog file must keep the original download URL." });
      }
      if (!file?.hashes?.sha1) {
        missing.push({ field: `files[${index}].hashes.sha1`, reason: "Catalog file must include a pinned sha1 hash." });
      }
      if (!file?.hashes?.sha512) {
        missing.push({ field: `files[${index}].hashes.sha512`, reason: "Catalog file must include a pinned sha512 hash." });
      }
      if (!Number.isInteger(file?.size) || file.size <= 0) {
        missing.push({ field: `files[${index}].size`, reason: "Catalog file must include a positive integer size." });
      }
    }
  }

  const complete = missing.length === 0;
  return {
    state: complete ? MetadataStates.COMPLETE : MetadataStates.INCOMPLETE,
    complete,
    recommendationState: complete ? RecommendationStates.READY : RecommendationStates.BLOCKED,
    missing
  };
}

export function createCatalogRecommendation({ entry, category = "recommended", rank = null, reason = "" }) {
  const metadataCompleteness = evaluateCatalogEntryMetadata(entry);

  return {
    projectId: entry.projectId ?? entry.id,
    title: entry.title ?? entry.slug ?? entry.projectId ?? entry.id,
    slug: entry.slug,
    category,
    rank,
    reason,
    source: entry.source ?? {
      provider: entry.metadataSource,
      projectUrl: entry.sourceUrl
    },
    metadataCompleteness,
    recommendation: {
      state: metadataCompleteness.complete ? RecommendationStates.READY : RecommendationStates.BLOCKED,
      canRecommend: metadataCompleteness.complete,
      userLabel: metadataCompleteness.complete ? "검증 가능" : "검증 불가"
    },
    compatibilityInput: toCompatibilityInput(entry)
  };
}

export function toCompatibilityInput(entry) {
  return {
    projectId: entry.projectId ?? entry.id,
    title: entry.title ?? entry.slug ?? entry.projectId ?? entry.id,
    slug: entry.slug,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    metadataSource: entry.metadataSource,
    license: entry.license,
    permission: entry.permission,
    side: entry.side,
    version: entry.version,
    files: entry.files,
    metadataCompleteness: evaluateCatalogEntryMetadata(entry)
  };
}

function normalizeFiles(files) {
  return files.map((file) => ({
    filename: file.filename,
    url: file.url,
    hashes: { ...(file.hashes ?? {}) },
    size: file.size,
    primary: Boolean(file.primary)
  }));
}

function normalizeDependencies(dependencies) {
  return dependencies.map((dependency) => ({
    projectId: dependency.project_id ?? dependency.projectId,
    versionId: dependency.version_id ?? dependency.versionId ?? null,
    type: dependency.dependency_type ?? dependency.type,
    source: dependency.source
  }));
}

function normalizeSide(clientSide, serverSide) {
  return {
    client: normalizeSideValue(clientSide),
    server: normalizeSideValue(serverSide)
  };
}

function normalizeSideValue(value) {
  if (value === "required" || value === "optional" || value === "unsupported") {
    return value;
  }

  return undefined;
}

function sideToEnv(side) {
  return {
    client: side?.client ?? "optional",
    server: side?.server ?? "optional"
  };
}

function normalizeLicense(license) {
  if (!license) {
    return null;
  }

  if (typeof license === "string") {
    return license;
  }

  return license.id ?? license.name ?? null;
}

function defaultPermissionRecord() {
  return {
    redistribution: "original_url_only",
    use: "allowed_by_license"
  };
}

function requireField(missing, field, value, reason) {
  if (value === null || value === undefined || value === "") {
    missing.push({ field, reason });
  }
}

function hasCompleteSideMetadata(side) {
  return isKnownSideValue(side?.client) && isKnownSideValue(side?.server);
}

function isKnownSideValue(value) {
  return value === "required" || value === "optional" || value === "unsupported";
}
