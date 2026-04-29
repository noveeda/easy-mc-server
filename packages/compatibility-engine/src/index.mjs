export const RiskLabels = Object.freeze({
  HIGH_CONFIDENCE: "high_confidence",
  CAUTION: "caution",
  LIKELY_FAIL: "likely_fail"
});

export function evaluateCompatibility({ selectedMods, catalog = [], minecraftVersion, loader = "fabric", knownConflicts = [] }) {
  const selected = selectedMods.map(normalizeSelectedMod);
  const catalogById = buildCatalog(catalog, selected);
  const selectedIds = new Set(selected.map((mod) => mod.projectId));
  const unsupported = selected.filter((mod) => !supportsTarget(mod, minecraftVersion, loader));
  const dependencyPlan = resolveDependencyPlan({ selectedMods: selected, catalog: Array.from(catalogById.values()), minecraftVersion, loader });
  const conflicts = findKnownConflicts(selectedIds, knownConflicts);

  let label = RiskLabels.HIGH_CONFIDENCE;
  if (unsupported.length > 0 || dependencyPlan.missingDependencies.length > 0 || dependencyPlan.automaticAddSuggestions.length > 0) {
    label = RiskLabels.LIKELY_FAIL;
  } else if (conflicts.length > 0 || selected.some((mod) => classifySide(mod) === "unknown")) {
    label = RiskLabels.CAUTION;
  }

  return {
    label,
    selectedModIds: [...selectedIds],
    sideClassifications: Object.fromEntries(selected.map((mod) => [mod.projectId, classifySide(mod)])),
    unsupported: unsupported.map((mod) => ({
      projectId: mod.projectId,
      title: mod.title,
      reason: `Not marked compatible with Minecraft ${minecraftVersion} and ${loader}.`
    })),
    missingDependencies: dependencyPlan.missingDependencies,
    automaticAddSuggestions: dependencyPlan.automaticAddSuggestions,
    resolvedModIds: dependencyPlan.resolvedMods.map((mod) => mod.projectId),
    conflicts,
    advice: buildAdvice({ label, unsupported, dependencyPlan, conflicts })
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

function buildAdvice({ label, unsupported, dependencyPlan, conflicts }) {
  if (label === RiskLabels.HIGH_CONFIDENCE) {
    return "This set is marked compatible for the selected Minecraft and Fabric version.";
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
