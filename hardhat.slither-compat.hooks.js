import fs from "node:fs/promises";
import path from "node:path";

const SLITHER_ARTIFACTS_DIR = "slither-artifacts";

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function stripVersionFromPackageSegment(packageSegment) {
  const versionSeparatorIndex = packageSegment.lastIndexOf("@");

  if (versionSeparatorIndex === -1) {
    return packageSegment;
  }

  return packageSegment.slice(0, versionSeparatorIndex);
}

function normalizeSourcePath(sourcePath) {
  const posixPath = sourcePath.replaceAll("\\", "/");

  if (posixPath.startsWith("project/")) {
    return posixPath.slice("project/".length);
  }

  if (!posixPath.startsWith("npm/")) {
    return posixPath;
  }

  const dependencyPath = posixPath.slice("npm/".length);
  const segments = dependencyPath.split("/");

  if (segments[0]?.startsWith("@") && segments.length >= 2) {
    const packageScope = segments[0];
    const packageName = stripVersionFromPackageSegment(segments[1]);

    return [packageScope, packageName, ...segments.slice(2)].join("/");
  }

  if (segments.length >= 1) {
    const packageName = stripVersionFromPackageSegment(segments[0]);

    return [packageName, ...segments.slice(1)].join("/");
  }

  return posixPath;
}

function remapObjectKeys(record, pathMap) {
  if (!record) {
    return record;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [pathMap.get(key) ?? key, value]),
  );
}

function replaceMappedStringValues(value, pathMap) {
  if (typeof value === "string") {
    return pathMap.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceMappedStringValues(item, pathMap));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      replaceMappedStringValues(entryValue, pathMap),
    ]),
  );
}

function normalizeBuildInfoPaths(buildInfo, buildInfoOutput) {
  const sourcePaths = [
    ...Object.keys(buildInfo.input?.sources ?? {}),
    ...Object.keys(buildInfoOutput.output?.sources ?? {}),
    ...Object.keys(buildInfoOutput.output?.contracts ?? {}),
  ];
  const pathMap = new Map(
    sourcePaths.map((sourcePath) => [sourcePath, normalizeSourcePath(sourcePath)]),
  );

  return replaceMappedStringValues(
    {
      ...buildInfo,
      input: {
        ...buildInfo.input,
        sources: remapObjectKeys(buildInfo.input?.sources, pathMap),
      },
      output: {
        ...buildInfoOutput.output,
        sources: remapObjectKeys(buildInfoOutput.output?.sources, pathMap),
        contracts: remapObjectKeys(buildInfoOutput.output?.contracts, pathMap),
      },
    },
    pathMap,
  );
}

async function writeSlitherBuildInfoMirror(artifactsDir) {
  const sourceBuildInfoDir = path.join(artifactsDir, "build-info");
  const targetBuildInfoDir = path.join(
    path.dirname(artifactsDir),
    SLITHER_ARTIFACTS_DIR,
    "build-info",
  );

  if (!(await pathExists(sourceBuildInfoDir))) {
    return;
  }

  await fs.rm(targetBuildInfoDir, { recursive: true, force: true });
  await fs.mkdir(targetBuildInfoDir, { recursive: true });

  const buildInfoFiles = await fs.readdir(sourceBuildInfoDir);

  for (const fileName of buildInfoFiles) {
    if (!fileName.endsWith(".json") || fileName.endsWith(".output.json")) {
      continue;
    }

    const buildInfoPath = path.join(sourceBuildInfoDir, fileName);
    const outputPath = path.join(
      sourceBuildInfoDir,
      fileName.replace(/\.json$/u, ".output.json"),
    );

    if (!(await pathExists(outputPath))) {
      continue;
    }

    const [buildInfoRaw, outputRaw] = await Promise.all([
      fs.readFile(buildInfoPath, "utf8"),
      fs.readFile(outputPath, "utf8"),
    ]);

    const buildInfo = JSON.parse(buildInfoRaw);
    const buildInfoOutput = JSON.parse(outputRaw);

    const slitherCompatibleBuildInfo = normalizeBuildInfoPaths(
      buildInfo,
      buildInfoOutput,
    );

    await fs.writeFile(
      path.join(targetBuildInfoDir, fileName),
      JSON.stringify(slitherCompatibleBuildInfo),
      "utf8",
    );
  }
}

export default async () => ({
  build: async (context, rootFilePaths, options, next) => {
    const targetBuildInfoDir = path.join(
      context.config.paths.root,
      SLITHER_ARTIFACTS_DIR,
      "build-info",
    );

    await fs.rm(targetBuildInfoDir, { recursive: true, force: true });

    const result = await next(context, rootFilePaths, options);

    await writeSlitherBuildInfoMirror(context.config.paths.artifacts);

    return result;
  },
});
