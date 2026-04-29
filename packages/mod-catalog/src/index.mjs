export function normalizeModrinthVersion({ project, version, permission }) {
  if (!project || !version) {
    throw new TypeError("project and version metadata are required");
  }

  const projectId = version.project_id ?? project.id;
  const slug = project.slug ?? projectId;
  const side = normalizeSide(project.client_side, project.server_side);
  const files = normalizeFiles(version.files ?? []);

  return {
    id: projectId,
    projectId,
    slug,
    title: project.title ?? slug,
    description: project.description ?? project.body ?? "",
    sourceUrl: project.source_url ?? project.sourceUrl ?? `https://modrinth.com/mod/${slug}`,
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
    metadataSource: "modrinth"
  };
}

export function createCuratedPack({ name, versionId, summary, minecraftVersion, fabricLoaderVersion, mods }) {
  if (!Array.isArray(mods) || mods.length === 0) {
    throw new TypeError("mods must include at least one normalized catalog entry");
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
  return Boolean(
    entry?.sourceUrl &&
      entry?.license &&
      entry?.permission &&
      Array.isArray(entry?.files) &&
      entry.files.length > 0 &&
      entry.files.every((file) => file.url && file.hashes?.sha1 && file.hashes?.sha512 && Number.isInteger(file.size))
  );
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
    type: dependency.dependency_type ?? dependency.type
  }));
}

function normalizeSide(clientSide = "optional", serverSide = "optional") {
  return {
    client: normalizeSideValue(clientSide),
    server: normalizeSideValue(serverSide)
  };
}

function normalizeSideValue(value) {
  if (value === "required" || value === "optional" || value === "unsupported") {
    return value;
  }

  return "optional";
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
