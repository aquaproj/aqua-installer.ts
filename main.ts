import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { createHash } from "node:crypto";
import { chmod, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { arch, homedir, platform, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import process from "node:process";

interface InstallOptions {
  version?: string;
}

const BOOTSTRAP_VERSION = "v2.55.1";
const CHECKSUMS = new Map([
  [
    "aqua_darwin_amd64.tar.gz",
    "814bd2ba3b1db409e89eae126ad280413e4edfefe91f598ce173c3b21ba56ca8",
  ],
  [
    "aqua_darwin_arm64.tar.gz",
    "cdaa13dd96187622ef5bee52867c46d4cf10765963423dc8e867c7c4decccf4d",
  ],
  [
    "aqua_linux_amd64.tar.gz",
    "7371b9785e07c429608a21e4d5b17dafe6780dabe306ec9f4be842ea754de48a",
  ],
  [
    "aqua_linux_arm64.tar.gz",
    "283e0e274af47ff1d4d660a19e8084ae4b6aca23d901e95728a68a63dfb98c87",
  ],
  [
    "aqua_windows_amd64.zip",
    "3efa0eaecd4f252f9dcf0d3b723e77894657977dc91939aac7697380a3f476a1",
  ],
  [
    "aqua_windows_arm64.zip",
    "faf478d4db6e873ed85365e6864af31bf831317a1736b4ca7f3cf561e3a463ec",
  ],
]);

function getOS(): string {
  const os = platform();
  switch (os) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported OS: ${os}`);
  }
}

function getArch(): string {
  const architecture = arch();
  switch (architecture) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture: ${architecture}`);
  }
}

export function getInstallPath(os: string): string {
  const aquaRoot = process.env.AQUA_ROOT_DIR;
  if (os === "windows") {
    const base = aquaRoot ||
      join(homedir(), "AppData", "Local", "aquaproj-aqua");
    return join(base, "bin", "aqua.exe");
  } else {
    const xdgDataHome = process.env.XDG_DATA_HOME ||
      join(homedir(), ".local", "share");
    const base = aquaRoot || join(xdgDataHome, "aquaproj-aqua");
    return join(base, "bin", "aqua");
  }
}

async function downloadFile(url: string): Promise<string> {
  core.info(`Downloading ${url} ...`);
  return await tc.downloadTool(url);
}

async function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<void> {
  core.info("Verifying checksum ...");

  const fileData = await readFile(filePath);
  const hash = createHash("sha256");
  hash.update(fileData);
  const hashHex = hash.digest("hex");

  if (hashHex !== expectedChecksum) {
    throw new Error(
      `Checksum verification failed. Expected: ${expectedChecksum}, Got: ${hashHex}`,
    );
  }
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  isWindows: boolean,
): Promise<string> {
  if (isWindows) {
    return await tc.extractZip(archivePath, destDir);
  } else {
    return await tc.extractTar(archivePath, destDir);
  }
}

async function runAquaUpdate(
  aquaPath: string,
  version?: string,
): Promise<void> {
  const args = version ? ["update-aqua", version] : ["update-aqua"];
  core.info(`${aquaPath} ${args.join(" ")}`);

  await exec.exec(aquaPath, args);
}

export const install = async (options: InstallOptions = {}): Promise<void> => {
  const os = getOS();
  const architecture = getArch();
  const installPath = getInstallPath(os);

  const isWindows = os === "windows";
  const ext = isWindows ? "zip" : "tar.gz";
  const filename = `aqua_${os}_${architecture}.${ext}`;
  const url =
    `https://github.com/aquaproj/aqua/releases/download/${BOOTSTRAP_VERSION}/${filename}`;

  const expectedChecksum = CHECKSUMS.get(filename);
  if (!expectedChecksum) {
    throw new Error(`No checksum found for ${filename}`);
  }

  core.info(`Installing aqua ${BOOTSTRAP_VERSION} for bootstrapping...`);

  const tempDir = mkdtempSync(join(tmpdir(), "aqua-"));
  try {
    const downloadPath = await downloadFile(url);
    await verifyChecksum(downloadPath, expectedChecksum);

    const extractedPath = await extractArchive(
      downloadPath,
      tempDir,
      isWindows,
    );

    const aquaBinaryPath = join(
      extractedPath,
      isWindows ? "aqua.exe" : "aqua",
    );
    await chmod(aquaBinaryPath, 0o755);

    await runAquaUpdate(aquaBinaryPath, options.version);

    core.info("");
    core.info(
      "===============================================================",
    );
    core.info(`aqua is installed into ${installPath}`);
    core.info('Please add the path to the environment variable "PATH"');

    const installDirTemplate = isWindows
      ? "${AQUA_ROOT_DIR:-$HOME/AppData/Local/aquaproj-aqua}/bin"
      : "${AQUA_ROOT_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/aquaproj-aqua}/bin";
    core.info(`export PATH=${installDirTemplate}:$PATH`);
    core.info(
      "===============================================================",
    );
    core.info("");

    await exec.exec(installPath, ["-v"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
