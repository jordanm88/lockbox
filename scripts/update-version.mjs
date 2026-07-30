import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log("Usage: npm run version:update -- <version>");
  console.log("Example: npm run version:update -- 0.2.0");
}

function validateVersion(version) {
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${version ?? "<empty>"}`);
  }
}

async function updateJsonFile(filePath, update) {
  const original = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(original);
  update(parsed);
  const next = `${JSON.stringify(parsed, null, 2)}\n`;
  if (next !== original) {
    await fs.writeFile(filePath, next, "utf8");
  }
}

async function updateTextFile(filePath, replacer) {
  const original = await fs.readFile(filePath, "utf8");
  const next = replacer(original);
  if (next !== original) {
    await fs.writeFile(filePath, next, "utf8");
  }
}

const version = process.argv[2];

if (!version) {
  usage();
  process.exit(1);
}

try {
  validateVersion(version);

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageLockPath = path.join(repoRoot, "package-lock.json");
  const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

  await updateJsonFile(packageJsonPath, (data) => {
    data.version = version;
  });

  await updateJsonFile(packageLockPath, (data) => {
    data.version = version;
    if (data.packages?.[""]) {
      data.packages[""].version = version;
    }
  });

  await updateTextFile(cargoTomlPath, (content) => content.replace(/^version = ".*"$/m, `version = "${version}"`));
  await updateTextFile(tauriConfigPath, (content) => content.replace(/"version":\s*".*?"/, `"version": "${version}"`));

  console.log(`Updated version to ${version} in package.json, package-lock.json, Cargo.toml, and tauri.conf.json.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}