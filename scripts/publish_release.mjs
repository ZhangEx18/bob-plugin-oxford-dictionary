#!/usr/bin/env node
/**
 * Publish a built .bobplugin as a GitHub Release and record it in appcast.json.
 *
 * The release artifact cannot be produced in CI: it embeds the OALD/roots data
 * packs, which are private and absent from the repository. So this script takes
 * an artifact that `npm run build:release` already produced, verifies it with the
 * same gate used by the build, records its hash in appcast.json, and publishes it.
 *
 * Usage:
 *   node scripts/publish_release.mjs                 # verify, update appcast, publish
 *   node scripts/publish_release.mjs --dry-run       # verify and print, write nothing
 *   node scripts/publish_release.mjs --appcast-only  # update appcast.json only
 *   node scripts/publish_release.mjs --notes "..."   # override appcast desc / release notes
 *   node scripts/publish_release.mjs --version 8.5.0 # publish a version other than package.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");
const { verifyReleaseArtifact } = require("./release_validation.js");

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INFO_PATH = path.join(ROOT_DIR, "apps/bob-plugin/info.json");
const PLUGIN_PACKAGE_PATH = path.join(ROOT_DIR, "apps/bob-plugin/package.json");
const WORKSPACE_LOCK_PATH = path.join(ROOT_DIR, "package-lock.json");
const APPCAST_PATH = path.join(ROOT_DIR, "appcast.json");
const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = { dryRun: false, appcastOnly: false, version: null, notes: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--appcast-only") options.appcastOnly = true;
    else if (arg === "--version") options.version = argv[++index];
    else if (arg === "--notes") options.notes = argv[++index];
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function compareVersions(left, right) {
  const a = left.match(STABLE_VERSION);
  const b = right.match(STABLE_VERSION);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(a[index]) - Number(b[index]);
    if (delta !== 0) return delta;
  }
  return 0;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveVersion(options) {
  const pluginPackage = readJson(PLUGIN_PACKAGE_PATH);
  const info = readJson(INFO_PATH);
  const version = options.version || pluginPackage.version;

  if (!STABLE_VERSION.test(version)) {
    fail(`version must be a stable x.y.z release, got "${version}"`);
  }
  if (!options.version && info.version !== pluginPackage.version) {
    fail(
      `info.json version (${info.version}) must match package.json version (${pluginPackage.version})`,
    );
  }
  if (options.version && info.version !== version) {
    fail(`info.json version (${info.version}) must match the requested version (${version})`);
  }
  if (!info.identifier) fail("info.json must declare an identifier");
  if (!info.appcast) fail("info.json must declare an appcast URL");

  const lock = readJson(WORKSPACE_LOCK_PATH);
  const locked = lock.packages?.["apps/bob-plugin"]?.version;
  if (!options.version && locked !== version) {
    fail(`package-lock app version (${locked}) must be ${version}`);
  }

  return { version, info };
}

function artifactName(version) {
  return `bob-plugin-oald-dictionary${version}.bobplugin`;
}

function assertArtifactIdentity(artifactPath, version, info) {
  const zip = new AdmZip(artifactPath);
  const entry = zip.getEntry("info.json");
  if (!entry) fail("release artifact is missing info.json");

  const shipped = JSON.parse(entry.getData().toString("utf8"));
  if (shipped.identifier !== info.identifier) {
    fail(`artifact identifier (${shipped.identifier}) must be ${info.identifier}`);
  }
  if (shipped.version !== version) {
    fail(`artifact version (${shipped.version}) must be ${version}`);
  }
  if (!shipped.appcast) {
    fail("artifact info.json has no appcast field, so Bob cannot detect updates");
  }
  if (shipped.appcast !== info.appcast) {
    fail(`artifact appcast (${shipped.appcast}) must be ${info.appcast}`);
  }
}

function releaseBaseUrl(info) {
  const homepage = String(info.homepage || "").replace(/\/+$/, "");
  const match = homepage.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) {
    fail(`info.json homepage must be a GitHub repository URL, got "${info.homepage}"`);
  }
  return `${homepage}/releases/download`;
}

function buildAppcastEntry({ version, info, artifactPath, desc }) {
  return {
    version,
    desc,
    sha256: sha256(artifactPath),
    url: `${releaseBaseUrl(info)}/v${version}/${artifactName(version)}`,
    minBobVersion: info.minBobVersion || "1.0.0",
  };
}

function writeAppcast(info, entry) {
  const appcast = fs.existsSync(APPCAST_PATH)
    ? readJson(APPCAST_PATH)
    : { identifier: info.identifier, versions: [] };

  if (!appcast.identifier) appcast.identifier = info.identifier;
  if (appcast.identifier !== info.identifier) {
    fail(
      `appcast identifier (${appcast.identifier}) must match info.json identifier (${info.identifier})`,
    );
  }

  const versions = (appcast.versions || []).filter((item) => item.version !== entry.version);
  versions.push(entry);
  versions.sort((left, right) => compareVersions(right.version, left.version));
  appcast.versions = versions;

  fs.writeFileSync(APPCAST_PATH, `${JSON.stringify(appcast, null, 2)}\n`);
  return appcast;
}

function defaultNotes() {
  try {
    return execFileSync("git", ["log", "-1", "--pretty=%s"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function publishToGitHub(version, artifactPath, notes) {
  const tag = `v${version}`;
  let exists = true;
  try {
    execFileSync("gh", ["release", "view", tag], { cwd: ROOT_DIR, stdio: "pipe" });
  } catch {
    exists = false;
  }

  if (!exists) {
    execFileSync(
      "gh",
      ["release", "create", tag, artifactPath, "--title", tag, "--notes", notes || tag],
      { cwd: ROOT_DIR, stdio: "inherit" },
    );
    return "created";
  }

  execFileSync("gh", ["release", "upload", tag, artifactPath, "--clobber"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  return "updated";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version, info } = resolveVersion(options);

  const artifactPath = path.join(ROOT_DIR, "release", artifactName(version));
  if (!fs.existsSync(artifactPath)) {
    fail(
      `release artifact is missing: ${artifactPath}\n`
      + "       run `npm run build:release` first",
    );
  }

  verifyReleaseArtifact(artifactPath, version);
  assertArtifactIdentity(artifactPath, version, info);

  const desc = options.notes || defaultNotes() || `v${version}`;
  const entry = buildAppcastEntry({ version, info, artifactPath, desc });

  console.log(`version       ${version}`);
  console.log(`artifact      ${path.relative(ROOT_DIR, artifactPath)}`);
  console.log(`sha256        ${entry.sha256}`);
  console.log(`appcast url   ${entry.url}`);

  if (options.dryRun) {
    console.log("\n--dry-run: nothing written, no release created");
    console.log(JSON.stringify({ identifier: info.identifier, versions: [entry] }, null, 2));
    return;
  }

  writeAppcast(info, entry);
  console.log(`appcast       ${path.relative(ROOT_DIR, APPCAST_PATH)} updated`);

  if (options.appcastOnly) {
    console.log("\n--appcast-only: skipped GitHub release");
    return;
  }

  const result = publishToGitHub(version, artifactPath, desc);
  console.log(`github        release v${version} ${result}`);
}

main();
