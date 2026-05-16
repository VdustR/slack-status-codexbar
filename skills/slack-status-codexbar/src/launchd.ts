import path from "node:path";
import { APP_NAME, LAUNCH_AGENT_LABEL } from "./constants.js";

export interface LaunchAgentPaths {
  appHome: string;
  logDir: string;
  launchAgentPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface LaunchAgentPlistOptions {
  label: string;
  programArguments: string[];
  startIntervalSeconds: number;
  stdoutPath: string;
  stderrPath: string;
}

export function createLaunchAgentPaths(homeDir: string): LaunchAgentPaths {
  const appHome = path.join(
    homeDir,
    "Library",
    "Application Support",
    APP_NAME,
  );
  const logDir = path.join(homeDir, "Library", "Logs", APP_NAME);
  return {
    appHome,
    logDir,
    launchAgentPath: path.join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${LAUNCH_AGENT_LABEL}.plist`,
    ),
    stdoutPath: path.join(logDir, "launchd.out.log"),
    stderrPath: path.join(logDir, "launchd.err.log"),
  };
}

export function buildLaunchAgentPlist(
  options: LaunchAgentPlistOptions,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
${options.programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${Math.max(1, Math.floor(options.startIntervalSeconds))}</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.stderrPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
