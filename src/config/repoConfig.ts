import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import { errMsg } from "../core/errors";
import { parseConfigFile } from "./resolve";
import type { InoriConfig } from "./types";

// ── 仓库级配置文件（.github/inori.yml | .yaml）──

const CONFIG_CANDIDATES = ["inori.yml", "inori.yaml"] as const;

/**
 * 依次尝试读取 workspace 下的 .github/inori.yml / inori.yaml，
 * 不存在返回空对象；解析失败告警并返回空对象（不阻断评审）。
 */
export function loadRepoConfigFile(workspaceDir: string = process.cwd()): InoriConfig {
  for (const name of CONFIG_CANDIDATES) {
    const filePath = path.join(workspaceDir, ".github", name);
    if (!fs.existsSync(filePath)) continue;
    try {
      core.info(`读取仓库配置文件：${filePath}`);
      return parseConfigFile(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      core.warning(`解析配置文件 ${filePath} 失败：${errMsg(e)}`);
    }
  }
  return {};
}
