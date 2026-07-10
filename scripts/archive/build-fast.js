const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { version } = require("./package.json");

const MAIN_JS_PATH = path.resolve(__dirname, "./dist/main.js");
const PLUGIN_NAME = `bob-plugin-oald-dictionary${version}.bobplugin`;
const ARTIFACT_PATH = path.resolve(__dirname, `./release/${PLUGIN_NAME}`);

const INFO_JSON = {
  identifier: "com.oald.dictionary",
  version: version,
  category: "translate",
  name: "牛津高阶英汉双解词典",
  author: "oald-user",
  minBobVersion: "1.0.0",
};

const createZip = () => {
  console.log("Creating zip...");
  const start = Date.now();
  
  const zip = new AdmZip();
  zip.addLocalFile(MAIN_JS_PATH);
  
  ["icon.png"].forEach((file) => {
    zip.addLocalFile(`./static/${file}`);
  });
  
  const dictDir = path.resolve(__dirname, "./dict");
  if (fs.existsSync(dictDir)) {
    const files = fs.readdirSync(dictDir);
    console.log(`Adding ${files.length} dictionary files...`);
    files.forEach((file) => {
      zip.addLocalFile(path.join(dictDir, file), "dict");
    });
  }
  
  zip.addFile("info.json", JSON.stringify(INFO_JSON));
  zip.writeZip(ARTIFACT_PATH);
  
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const size = (fs.statSync(ARTIFACT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Zip created in ${duration}s (${size}MB)`);
};

require("esbuild")
  .build({
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    treeShaking: true,
    outfile: MAIN_JS_PATH,
    external: ["@bob-plug/core"],
  })
  .then(() => {
    createZip();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
