const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const core = require("C:/Users/IPS/AppData/Roaming/npm/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core");

const targetDirectory = process.cwd();
const manifestFile = path.join(targetDirectory, "twa-manifest.json");

(async () => {
  const twaManifest = await core.TwaManifest.fromFile(manifestFile);
  const twaGenerator = new core.TwaGenerator();
  const log = new core.ConsoleLog("Generating TWA");
  const progress = () => {};
  if (fs.existsSync(targetDirectory)) {
    await twaGenerator.removeTwaProject(targetDirectory);
  }
  await twaGenerator.createTwaProject(targetDirectory, twaManifest, log, progress);
  const manifestContents = await fs.promises.readFile(manifestFile);
  const sum = crypto.createHash("sha1").update(manifestContents).digest("hex");
  await fs.promises.writeFile(path.join(targetDirectory, "manifest-checksum.txt"), sum);
  console.log("PROJECT_GENERATED checksum=" + sum);
})().catch((e) => {
  console.error("GEN_ERROR", e);
  process.exit(1);
});