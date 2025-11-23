import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Untar } from "@std/archive/untar";
import { readerFromStreamReader } from "@std/io/reader-from-stream-reader";

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
  const os = Deno.build.os;
  switch (os) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "windows":
      return "windows";
    default:
      throw new Error(`Unsupported OS: ${os}`);
  }
}

function getArch(): string {
  const arch = Deno.build.arch;
  switch (arch) {
    case "x86_64":
      return "amd64";
    case "aarch64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }
}

function getInstallPath(os: string): string {
  const aquaRoot = Deno.env.get("AQUA_ROOT_DIR");
  if (os === "windows") {
    const base = aquaRoot ||
      join(Deno.env.get("HOME") || "", "AppData", "Local", "aquaproj-aqua");
    return join(base, "bin", "aqua.exe");
  } else {
    const xdgDataHome = Deno.env.get("XDG_DATA_HOME") ||
      join(Deno.env.get("HOME") || "", ".local", "share");
    const base = aquaRoot || join(xdgDataHome, "aquaproj-aqua");
    return join(base, "bin", "aqua");
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.error(`[INFO] Downloading ${url} ...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const file = await Deno.open(destPath, { write: true, create: true });
  await response.body?.pipeTo(file.writable);
}

async function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<void> {
  console.error(`[INFO] Verifying checksum ...`);

  const fileData = await Deno.readFile(filePath);
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

  if (hashHex !== expectedChecksum) {
    throw new Error(
      `Checksum verification failed. Expected: ${expectedChecksum}, Got: ${hashHex}`,
    );
  }
}

async function extractTarGz(tarGzPath: string, destDir: string): Promise<void> {
  const file = await Deno.open(tarGzPath, { read: true });
  const reader = readerFromStreamReader(file.readable.pipeThrough(new DecompressionStream("gzip")).getReader());
  const untar = new Untar(reader);

  for await (const entry of untar) {
    if (entry.type === "file") {
      const destPath = join(destDir, entry.fileName);
      await ensureDir(join(destDir));
      const destFile = await Deno.open(destPath, {
        write: true,
        create: true,
      });
      await entry.pipeTo(destFile.writable);
    }
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const command = new Deno.Command("unzip", {
    args: ["-q", zipPath, "-d", destDir],
  });
  const output = await command.output();
  if (!output.success) {
    throw new Error("Failed to extract zip file");
  }
}

async function runAquaUpdate(
  aquaPath: string,
  version?: string,
): Promise<void> {
  const args = version ? ["update-aqua", version] : ["update-aqua"];
  console.error(`[INFO] ${aquaPath} ${args.join(" ")}`);

  const command = new Deno.Command(aquaPath, { args });
  const output = await command.output();

  if (!output.success) {
    throw new Error("Failed to run aqua update-aqua");
  }
}

export const install = async (options: InstallOptions = {}): Promise<void> => {
  const os = getOS();
  const arch = getArch();
  const installPath = getInstallPath(os);

  const isWindows = os === "windows";
  const ext = isWindows ? "zip" : "tar.gz";
  const filename = `aqua_${os}_${arch}.${ext}`;
  const url =
    `https://github.com/aquaproj/aqua/releases/download/${BOOTSTRAP_VERSION}/${filename}`;

  const expectedChecksum = CHECKSUMS.get(filename);
  if (!expectedChecksum) {
    throw new Error(`No checksum found for ${filename}`);
  }

  console.error(
    `[INFO] Installing aqua ${BOOTSTRAP_VERSION} for bootstrapping...`,
  );

  const tempDir = await Deno.makeTempDir();
  try {
    const downloadPath = join(tempDir, filename);
    await downloadFile(url, downloadPath);
    await verifyChecksum(downloadPath, expectedChecksum);

    if (isWindows) {
      await extractZip(downloadPath, tempDir);
    } else {
      await extractTarGz(downloadPath, tempDir);
    }

    const aquaBinaryPath = join(tempDir, isWindows ? "aqua.exe" : "aqua");
    await Deno.chmod(aquaBinaryPath, 0o755);

    await runAquaUpdate(aquaBinaryPath, options.version);

    console.error("");
    console.error("===============================================================");
    console.error(`[INFO] aqua is installed into ${installPath}`);
    console.error('[INFO] Please add the path to the environment variable "PATH"');

    const installDirTemplate = isWindows
      ? "${AQUA_ROOT_DIR:-$HOME/AppData/Local/aquaproj-aqua}/bin"
      : "${AQUA_ROOT_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/aquaproj-aqua}/bin";
    console.error(`[INFO] export PATH=${installDirTemplate}:$PATH`);
    console.error("===============================================================");
    console.error("");

    const versionCommand = new Deno.Command(installPath, { args: ["-v"] });
    const versionOutput = await versionCommand.output();
    console.log(new TextDecoder().decode(versionOutput.stdout));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
};
