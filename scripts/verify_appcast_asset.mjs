#!/usr/bin/env node
/**
 * Verify that a published GitHub Release asset matches the sha256 recorded in
 * appcast.json.
 *
 * appcast.json silently rots when a release is uploaded but the hash is not
 * refreshed (or the other way around). Bob refuses to install on a hash
 * mismatch, so the drift is only discovered by users. This closes the loop.
 *
 * Usage:
 *   node scripts/verify_appcast_asset.mjs              # newest appcast entry
 *   node scripts/verify_appcast_asset.mjs --version 8.4.2
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPCAST_PATH = path.join(ROOT_DIR, "appcast.json");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { version: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--version") options.version = argv[++index];
    else fail(`unknown argument: ${argv[index]}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appcast = JSON.parse(fs.readFileSync(APPCAST_PATH, "utf8"));
  const versions = appcast.versions || [];
  if (versions.length === 0) fail("appcast.json declares no versions");

  const entry = options.version
    ? versions.find((item) => item.version === options.version)
    : versions[0];
  if (!entry) fail(`appcast.json has no entry for version ${options.version}`);

  const tag = `v${entry.version}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oald-appcast-"));
  try {
    execFileSync(
      "gh",
      ["release", "download", tag, "--pattern", "*.bobplugin", "--dir", tmpDir, "--clobber"],
      { cwd: ROOT_DIR, stdio: "inherit" },
    );

    const files = fs.readdirSync(tmpDir).filter((name) => name.endsWith(".bobplugin"));
    if (files.length !== 1) {
      fail(`expected exactly one .bobplugin in ${tag}, found ${files.length}`);
    }

    const artifactPath = path.join(tmpDir, files[0]);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");

    console.log(`version   ${entry.version}`);
    console.log(`asset     ${files[0]}`);
    console.log(`appcast   ${entry.sha256}`);
    console.log(`actual    ${actual}`);

    if (actual !== entry.sha256) {
      fail(`sha256 mismatch for ${tag}: appcast.json must be refreshed`);
    }
    console.log("\nOK: appcast.json matches the published release asset");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
