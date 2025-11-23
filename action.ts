import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { install } from "./main.ts";
import process from "node:process";

export type ActionInputs = {
  version: string;
  githubToken?: string;
  enableAquaInstall?: boolean;
  aquaOpts?: string[];
  policyAllow?: string;
  skipInstallAqua?: boolean;
  workingDirectory?: string;
};

export async function action(inputs: ActionInputs): Promise<void> {
  if (!inputs.version) {
    core.setFailed("aqua_version is required");
    return;
  }

  const isWindows = platform() === "win32";
  const aquaRoot = process.env.AQUA_ROOT_DIR;

  let binPath: string;
  if (isWindows) {
    const base = aquaRoot ||
      join(homedir(), "AppData", "Local", "aquaproj-aqua");
    binPath = join(base, "bin");
  } else {
    const xdgDataHome = process.env.XDG_DATA_HOME ||
      join(homedir(), ".local", "share");
    const base = aquaRoot || join(xdgDataHome, "aquaproj-aqua");
    binPath = join(base, "bin");
  }

  core.addPath(binPath);

  if (inputs.skipInstallAqua) {
    try {
      await exec.exec("aqua", ["--version"], { silent: true });
      core.info("[INFO] Installing aqua is skipped");
    } catch {
      await install({ version: inputs.version });
    }
  } else {
    await install({ version: inputs.version });
  }

  if (inputs.policyAllow) {
    const opts: string[] = ["policy", "allow"];
    if (inputs.policyAllow !== "true") {
      opts.push(inputs.policyAllow);
    }
    await exec.exec("aqua", opts, {
      cwd: inputs.workingDirectory,
      env: {
        ...process.env,
        AQUA_GITHUB_TOKEN: inputs.githubToken ?? "",
      },
    });
  }

  if (inputs.enableAquaInstall ?? true) {
    core.startGroup("aqua install");
    try {
      await exec.exec("aqua", ["i", ...inputs.aquaOpts ?? []], {
        cwd: inputs.workingDirectory,
        env: {
          ...process.env,
          AQUA_GITHUB_TOKEN: inputs.githubToken ?? "",
        },
      });
    } finally {
      core.endGroup();
    }
  }
}
