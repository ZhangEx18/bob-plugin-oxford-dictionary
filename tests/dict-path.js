const path = require("path");
const { resolveDictDir, resolveManifestPath, resolveEcdictDir, resolveRootsDir } = require("../scripts/artifact_paths");

function getDictDir() {
  return resolveDictDir();
}

function getManifestPath() {
  return resolveManifestPath();
}

function getShardPath(char) {
  return path.join(getDictDir(), `${char}.json`);
}

function getEcdictDir() {
  return resolveEcdictDir();
}

function getEcdictShardPath(char) {
  return path.join(getEcdictDir(), `${char}.json`);
}

function getRootsDir() {
  return resolveRootsDir();
}

function getRootsShardPath(char) {
  return path.join(getRootsDir(), `${char}.json`);
}

module.exports = {
  getDictDir,
  getManifestPath,
  getShardPath,
  getEcdictDir,
  getEcdictShardPath,
  getRootsDir,
  getRootsShardPath,
};
