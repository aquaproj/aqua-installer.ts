import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { install  } from "./main.ts";

async function run(): Promise<void> {
  try {
    const aquaVersion = core.getInput("aqua_version", { required: true });
    const githubToken = core.getInput("github_token");
    const enableAquaInstall = core.getInput("enable_aqua_install") === "true";
    const aquaOpts = core.getInput("aqua_opts") || "-l";
    const policyAllow = core.getInput("policy_allow");
    const skipInstallAqua = core.getInput("skip_install_aqua") === "true";
    const workingDirectory = core.getInput("working_directory") || process.cwd();

    if (!aquaVersion) {
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

    if (skipInstallAqua) {
      try {
        await exec.exec("aqua", ["--version"], { silent: true });
        core.info("[INFO] Installing aqua is skipped");
      } catch {
        await install({ version: aquaVersion });
      }
    } else {
      await install({ version: aquaVersion });
    }

    if (policyAllow === "true") {
      await exec.exec("aqua", ["policy", "allow"], {
        cwd: workingDirectory,
        env: {
          ...process.env,
          GITHUB_TOKEN: githubToken,
        },
      });
    } else if (policyAllow) {
      await exec.exec("aqua", ["policy", "allow", policyAllow], {
        cwd: workingDirectory,
        env: {
          ...process.env,
          GITHUB_TOKEN: githubToken,
        },
      });
    }

    if (enableAquaInstall) {
      const opts = aquaOpts.split(/\s+/).filter((opt) => opt);
      await exec.exec("aqua", ["i", ...opts], {
        cwd: workingDirectory,
        env: {
          ...process.env,
          GITHUB_TOKEN: githubToken,
        },
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

run();
