const path = require("path");
const { resolveDictDir, resolveManifestPath, resolveEcdictDir } = require("../scripts/artifact_paths");

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

module.exports = {
  getDictDir,
  getManifestPath,
  getShardPath,
  getEcdictDir,
  getEcdictShardPath,
};
