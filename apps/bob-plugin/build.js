/** @typedef {{ identifier: string; version: string; category: string; name: string; author: string; minBobVersion: string; }} PluginInfo */

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { version } = require("./package.json");
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const workspaceLock = require(path.join(WORKSPACE_ROOT, "package-lock.json"));
const {
  resolveDictDir,
  resolveManifestPath,
  resolveRootsDir,
} = require(path.join(WORKSPACE_ROOT, "scripts", "artifact_paths.js"));
const {
  validateSourcePack,
  verifyReleaseArtifact,
} = require(path.join(WORKSPACE_ROOT, "scripts", "release_validation.js"));

const MAIN_JS_PATH = path.resolve(WORKSPACE_ROOT, "./dist/main.js");
const PLUGIN_NAME = `bob-plugin-oald-dictionary${version}.bobplugin`;
const ARTIFACT_PATH = path.resolve(WORKSPACE_ROOT, `./release/${PLUGIN_NAME}`);

/** @type {PluginInfo} */
const INFO_JSON = {
  identifier: "com.oald.dictionary",
  version: version,
  category: "translate",
  name: "牛津高阶英汉双解词典",
  author: "oald-user",
  minBobVersion: "1.0.0",
};

const isRelease = process.argv.includes("--release");
const isWatch = process.argv.includes("--watch");

if (isRelease && isWatch) {
  throw new Error("--release and --watch cannot be used together");
}
if (isRelease && workspaceLock.packages?.["apps/bob-plugin"]?.version !== version) {
  throw new Error(`package-lock app version must be ${version}`);
}

fs.mkdirSync(path.dirname(MAIN_JS_PATH), { recursive: true });
fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });

const dictDir = resolveDictDir();
const manifestPath = resolveManifestPath();
const rootsDir = resolveRootsDir();
const rootsManifestPath = path.join(rootsDir, "..", "manifest.json");
const rootsCsvDir = path.resolve(WORKSPACE_ROOT, "./.cache/oald-build/output/packs/roots-csv/latest/words");
const rootsCsvManifestPath = path.resolve(WORKSPACE_ROOT, "./.cache/oald-build/output/packs/roots-csv/latest/manifest.json");

function validateOptionalRootsCsvPack() {
  if (!fs.existsSync(rootsCsvDir) && !fs.existsSync(rootsCsvManifestPath)) return null;
  return validateSourcePack({
    manifestPath: rootsCsvManifestPath,
    shardDir: rootsCsvDir,
    packType: "roots",
    shardSubdir: "words",
  });
}

const releasePacks = isRelease
  ? {
      oald: validateSourcePack({
        manifestPath,
        shardDir: dictDir,
        packType: "oald",
        shardSubdir: "dict",
      }),
      roots: validateSourcePack({
        manifestPath: rootsManifestPath,
        shardDir: rootsDir,
        packType: "roots",
        shardSubdir: "words",
      }),
      rootsCsv: validateOptionalRootsCsvPack(),
    }
  : null;

function addFiles(zip, directory, files, zipDirectory) {
  for (const file of files) {
    zip.addLocalFile(path.join(directory, file), zipDirectory);
  }
}

function addPack(zip, { shardDir, manifestFile, declaredFiles, zipRoot, shardSubdir }) {
  if (fs.existsSync(shardDir)) {
    const files = declaredFiles || fs.readdirSync(shardDir).filter((file) => file.endsWith(".json"));
    addFiles(zip, shardDir, files, `${zipRoot}/${shardSubdir}`);
  }
  if (fs.existsSync(manifestFile)) {
    zip.addLocalFile(manifestFile, zipRoot, "manifest.json");
  }
}

function addPluginAssets(zip) {
  zip.addLocalFile(MAIN_JS_PATH);
  zip.addLocalFile(path.resolve(__dirname, "./static/icon.png"));
  zip.addFile("info.json", JSON.stringify(INFO_JSON));
}

function addDictionaryPacks(zip) {
  addPack(zip, {
    shardDir: dictDir,
    manifestFile: manifestPath,
    declaredFiles: releasePacks?.oald.files,
    zipRoot: "packs/oald/2024.09",
    shardSubdir: "dict",
  });
  addPack(zip, {
    shardDir: rootsDir,
    manifestFile: rootsManifestPath,
    declaredFiles: releasePacks?.roots.files,
    zipRoot: "packs/roots/latest",
    shardSubdir: "words",
  });
}

function addRootsSupplement(zip) {
  addPack(zip, {
    shardDir: rootsCsvDir,
    manifestFile: rootsCsvManifestPath,
    declaredFiles: releasePacks?.rootsCsv?.files,
    zipRoot: "packs/roots-csv/latest",
    shardSubdir: "words",
  });
}

const createZip = () => {
  const zip = new AdmZip();
  addPluginAssets(zip);
  addDictionaryPacks(zip);
  addRootsSupplement(zip);
  const outputPath = isRelease ? ARTIFACT_PATH : path.resolve(WORKSPACE_ROOT, `./dist/${PLUGIN_NAME}`);
  zip.writeZip(outputPath);
  if (isRelease) verifyReleaseArtifact(outputPath, version);
  console.log(new Date(), "Zip created");
};

// Type-check first
const { execSync } = require("child_process");
try {
  execSync("npm run lint", { stdio: "inherit", cwd: __dirname });
} catch (e) {
  console.error("Build prerequisite failed. Fix errors before building.");
  if (e instanceof Error && e.message) {
    console.error(e.message);
  }
  process.exit(1);
}

require("esbuild")
  .build({
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    treeShaking: true,
    outfile: MAIN_JS_PATH,
    external: ["@bob-plug/core"],
    watch: isWatch
      ? {
          onRebuild(error, result) {
            if (error) {
              console.error("watch build failed:", error);
            } else {
              console.log("watch build succeeded:", result);
              createZip();
            }
          },
        }
      : false,
  })
  .then(() => {
    createZip();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
