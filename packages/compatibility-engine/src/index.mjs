export const RiskLabels = Object.freeze({
  HIGH_CONFIDENCE: "high_confidence",
  CAUTION: "caution",
  LIKELY_FAIL: "likely_fail"
});

export const RiskDisplayLabels = Object.freeze({
  [RiskLabels.HIGH_CONFIDENCE]: "높은 신뢰",
  [RiskLabels.CAUTION]: "주의",
  [RiskLabels.LIKELY_FAIL]: "실패 가능"
});

export function evaluateCompatibility({ selectedMods, catalog = [], minecraftVersion, loader = "fabric", knownConflicts = [] }) {
  const selected = selectedMods.map(normalizeSelectedMod);
  const catalogById = buildCatalog(catalog, selected);
  const selectedIds = new Set(selected.map((mod) => mod.projectId));
  const metadataIssues = selected.map(evaluateModMetadata).filter((issue) => !issue.complete);
  const unsupported = selected.filter((mod) => !supportsTarget(mod, minecraftVersion, loader));
  const dependencyPlan = resolveDependencyPlan({ selectedMods: selected, catalog: Array.from(catalogById.values()), minecraftVersion, loader });
  const conflicts = findKnownConflicts(selectedIds, knownConflicts);

  let label = RiskLabels.HIGH_CONFIDENCE;
  if (
    metadataIssues.length > 0 ||
    unsupported.length > 0 ||
    dependencyPlan.missingDependencies.length > 0 ||
    dependencyPlan.automaticAddSuggestions.length > 0
  ) {
    label = RiskLabels.LIKELY_FAIL;
  } else if (conflicts.length > 0 || selected.some((mod) => classifySide(mod) === "unknown")) {
    label = RiskLabels.CAUTION;
  }

  const advice = buildAdvice({ label, metadataIssues, unsupported, dependencyPlan, conflicts });

  return {
    label,
    userLabel: RiskDisplayLabels[label],
    verdict: {
      label,
      userLabel: RiskDisplayLabels[label],
      canRecommend: label !== RiskLabels.LIKELY_FAIL,
      canGeneratePack: label !== RiskLabels.LIKELY_FAIL,
      summary: advice
    },
    selectedModIds: [...selectedIds],
    sideClassifications: Object.fromEntries(selected.map((mod) => [mod.projectId, classifySide(mod)])),
    metadataIssues,
    unsupported: unsupported.map((mod) => ({
      projectId: mod.projectId,
      title: mod.title,
      reason: `Not marked compatible with Minecraft ${minecraftVersion} and ${loader}.`
    })),
    missingDependencies: dependencyPlan.missingDependencies,
    automaticAddSuggestions: dependencyPlan.automaticAddSuggestions,
    resolvedModIds: dependencyPlan.resolvedMods.map((mod) => mod.projectId),
    conflicts,
    advice
  };
}

export function resolveDependencyPlan({ selectedMods, catalog = [], minecraftVersion, loader = "fabric" }) {
  const selected = selectedMods.map(normalizeSelectedMod);
  const catalogById = buildCatalog(catalog, selected);
  const selectedIds = new Set(selected.map((mod) => mod.projectId));
  const automaticAddSuggestions = [];
  const missingDependencies = [];

  for (const mod of selected) {
    for (const dependency of requiredDependencies(mod)) {
      if (selectedIds.has(dependency.projectId)) {
        continue;
      }

      const candidate = catalogById.get(dependency.projectId);
      if (candidate && supportsTarget(candidate, minecraftVersion, loader)) {
        const candidateMetadata = evaluateModMetadata(candidate);
        if (!candidateMetadata.complete) {
          missingDependencies.push({
            projectId: dependency.projectId,
            requiredBy: mod.projectId,
            reason: `${candidate.title} is present in the catalog, but its metadata is incomplete.`,
            metadataIssues: candidateMetadata.missing
          });
          continue;
        }

        automaticAddSuggestions.push({
          projectId: candidate.projectId,
          title: candidate.title,
          requiredBy: mod.projectId,
          reason: `${mod.title} requires ${candidate.title}.`
        });
        selectedIds.add(candidate.projectId);
        continue;
      }

      missingDependencies.push({
        projectId: dependency.projectId,
        requiredBy: mod.projectId,
        reason: `${mod.title} has a required dependency that is not in the curated catalog.`
      });
    }
  }

  return {
    resolvedMods: [...selected, ...automaticAddSuggestions.map((suggestion) => catalogById.get(suggestion.projectId))],
    automaticAddSuggestions,
    missingDependencies
  };
}

export function classifySide(mod) {
  if (mod?.sideMetadataComplete === false || !hasCompleteSideMetadata(mod?.side)) {
    return "unknown";
  }

  const side = normalizeSelectedMod(mod).side;

  if (side.client === "unsupported" && side.server !== "unsupported") {
    return "server_only";
  }

  if (side.server === "unsupported" && side.client !== "unsupported") {
    return "client_only";
  }

  if (side.client === "unsupported" && side.server === "unsupported") {
    return "unknown";
  }

  if (side.client && side.server) {
    return "both_sides";
  }

  return "unknown";
}

function normalizeSelectedMod(mod) {
  const projectId = mod.projectId ?? mod.id;
  return {
    ...mod,
    projectId,
    title: mod.title ?? mod.slug ?? projectId,
    side: {
      client: mod.side?.client ?? "optional",
      server: mod.side?.server ?? "optional"
    },
    sideMetadataComplete: hasCompleteSideMetadata(mod.side),
    version: {
      ...(mod.version ?? {}),
      gameVersions: mod.version?.gameVersions ?? mod.gameVersions ?? [],
      loaders: mod.version?.loaders ?? mod.loaders ?? [],
      dependencies: mod.version?.dependencies ?? mod.dependencies ?? []
    }
  };
}

function supportsTarget(mod, minecraftVersion, loader) {
  const normalized = normalizeSelectedMod(mod);
  return normalized.version.gameVersions.includes(minecraftVersion) && normalized.version.loaders.includes(loader);
}

function requiredDependencies(mod) {
  return normalizeSelectedMod(mod).version.dependencies.filter((dependency) => dependency.type === "required" && dependency.projectId);
}

function buildCatalog(catalog, selected) {
  const entries = new Map();
  for (const mod of [...catalog, ...selected]) {
    const normalized = normalizeSelectedMod(mod);
    entries.set(normalized.projectId, normalized);
  }
  return entries;
}

function findKnownConflicts(selectedIds, knownConflicts) {
  return knownConflicts
    .map((conflict) => ({
      mods: conflict.mods ?? [conflict.a, conflict.b],
      advice: conflict.advice ?? "Use only one of these mods in this pack."
    }))
    .filter((conflict) => conflict.mods.every((modId) => selectedIds.has(modId)));
}

function buildAdvice({ label, metadataIssues, unsupported, dependencyPlan, conflicts }) {
  if (label === RiskLabels.HIGH_CONFIDENCE) {
    return "This set is marked compatible for the selected Minecraft and Fabric version.";
  }

  if (metadataIssues.length > 0) {
    return "Some selected mods are missing metadata needed for a safe recommendation.";
  }

  if (unsupported.length > 0) {
    return "Choose versions that list the selected Minecraft version and Fabric loader before generating the pack.";
  }

  if (dependencyPlan.missingDependencies.length > 0) {
    return "Add the required dependencies or choose another mod before generating the pack.";
  }

  if (conflicts.length > 0) {
    return conflicts[0].advice;
  }

  return "Review this combination before recommending it.";
}

function evaluateModMetadata(mod) {
  const normalized = normalizeSelectedMod(mod);
  const missing = [];
  const sourceProvider = mod?.source?.provider ?? mod?.metadataSource;
  const sourceUrl = mod?.sourceUrl ?? mod?.source?.projectUrl ?? mod?.source?.url;

  requireField(missing, "source.provider", sourceProvider, "Mod metadata must identify the source provider.");
  requireField(missing, "sourceUrl", sourceUrl, "Mod metadata must keep the original source URL.");
  requireField(missing, "license", mod?.license, "Mod metadata must include license metadata.");
  requireField(missing, "permission", mod?.permission, "Mod metadata must include redistribution permission metadata.");

  if (mod?.sideMetadataComplete === false || !hasCompleteSideMetadata(mod?.side)) {
    missing.push({
      field: "side",
      reason: "Mod metadata must include explicit client and server side support."
    });
  }

  if (!Array.isArray(normalized.version.gameVersions) || normalized.version.gameVersions.length === 0) {
    missing.push({
      field: "version.gameVersions",
      reason: "Mod metadata must list supported Minecraft versions."
    });
  }

  if (!Array.isArray(normalized.version.loaders) || normalized.version.loaders.length === 0) {
    missing.push({
      field: "version.loaders",
      reason: "Mod metadata must list supported loaders."
    });
  }

  if (!Array.isArray(normalized.version.dependencies)) {
    missing.push({
      field: "version.dependencies",
      reason: "Mod metadata must include a dependency list, even when empty."
    });
  }

  if (!Array.isArray(mod?.files) || mod.files.length === 0) {
    missing.push({
      field: "files",
      reason: "Mod metadata must include at least one downloadable file."
    });
  } else {
    for (const [index, file] of mod.files.entries()) {
      if (!file?.url) {
        missing.push({ field: `files[${index}].url`, reason: "Mod file must keep the original download URL." });
      }
      if (!file?.hashes?.sha1) {
        missing.push({ field: `files[${index}].hashes.sha1`, reason: "Mod file must include a pinned sha1 hash." });
      }
      if (!file?.hashes?.sha512) {
        missing.push({ field: `files[${index}].hashes.sha512`, reason: "Mod file must include a pinned sha512 hash." });
      }
      if (!Number.isInteger(file?.size) || file.size <= 0) {
        missing.push({ field: `files[${index}].size`, reason: "Mod file must include a positive integer size." });
      }
    }
  }

  return {
    projectId: normalized.projectId,
    title: normalized.title,
    complete: missing.length === 0,
    missing
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
