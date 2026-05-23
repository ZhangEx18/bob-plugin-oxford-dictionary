/** @typedef {{ identifier: string; version: string; category: string; name: string; author: string; minBobVersion: string; }} PluginInfo */

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { version } = require("./package.json");

const MAIN_JS_PATH = path.resolve(__dirname, "./dist/main.js");
const PLUGIN_NAME = `bob-plugin-oald-dictionary${version}.bobplugin`;
const ARTIFACT_PATH = path.resolve(__dirname, `./release/${PLUGIN_NAME}`);

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

const createZip = () => {
  const zip = new AdmZip();
  zip.addLocalFile(MAIN_JS_PATH);
  ["icon.png"].forEach((file) => {
    zip.addLocalFile(`./static/${file}`);
  });
  // Add dict shards
  const dictDir = path.resolve(__dirname, "./dict");
  if (fs.existsSync(dictDir)) {
    const files = fs.readdirSync(dictDir);
    files.forEach((file) => {
      zip.addLocalFile(path.join(dictDir, file), "dict");
    });
  }
  zip.addFile("info.json", JSON.stringify(INFO_JSON));
  zip.writeZip(isRelease ? ARTIFACT_PATH : path.resolve(__dirname, `./dist/${PLUGIN_NAME}`));
  console.log(new Date(), "Zip created");
};

// Type-check first
const { execSync } = require("child_process");
try {
  execSync("npx tsc --noEmit", { stdio: "inherit", cwd: __dirname });
} catch (e) {
  console.error("TypeScript check failed. Fix errors before building.");
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
    watch: isRelease
      ? false
      : {
          onRebuild(error, result) {
            if (error) {
              console.error("watch build failed:", error);
            } else {
              console.log("watch build succeeded:", result);
              createZip();
            }
          },
        },
  })
  .then(() => {
    createZip();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
