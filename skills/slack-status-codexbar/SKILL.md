---
name: slack-status-codexbar
description: Sync CodexBar usage into Slack custom status. Use when the user wants Slack status to show CodexBar provider usage, AI quota status, multiple agent/provider limits, or install/configure/uninstall the SlackStatusCodexBar LaunchAgent integration.
---

# SlackStatusCodexBar

Syncs CodexBar usage into Slack custom status.

This skill is agent-neutral. CodexBar owns provider discovery and credentials; this integration owns Slack profile writes, formatting, throttling, logs, and launchd scheduling.

## Defaults

- Runtime home: `~/Library/Application Support/SlackStatusCodexBar/`
- Logs: `~/Library/Logs/SlackStatusCodexBar/`
- LaunchAgent: `~/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist`
- Refresh cadence: every 5 minutes
- Slack status expiration: none (`status_expiration: 0`)
- Primary CodexBar source:

```text
~/Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json
```

- Fallback CodexBar command:

```bash
codexbar usage --format json --json-only
```

Do not pass `--provider` or `--source` by default in the fallback command. The integration should inherit enabled providers, source mode, order, token accounts, cookies, OAuth, and API keys from CodexBar. Prefer the widget snapshot because it matches the CodexBar GUI and includes app-side reset-time backfills.

## References

- Preinstall checks: see [references/preinstall.md](references/preinstall.md)
- Secret handling: see [references/secrets.md](references/secrets.md)
- Uninstall: see [references/uninstall.md](references/uninstall.md)

## Prerequisites

Keep this short in normal use. If a dependency is missing, guide the user through installing it with their preferred toolchain instead of embedding long install instructions here.

Check without printing secrets:

1. Node 22+
2. pnpm
3. Dependencies installed in this skill root
4. CodexBar app is installed and can write `widget-snapshot.json`
5. `codexbar` exists on PATH for fallback diagnostics
6. `codexbar config validate` passes
7. Slack user token exists:
   - `SLACK_STATUS_USER_TOKEN`, or
   - `SLACK_MCP_XOXP_TOKEN`

The Slack token must be an `xoxp-` user token with `users.profile:read` and `users.profile:write`.

Before configuring secrets, ask the user how they want the Slack token obtained at runtime:

- load from an existing user env source such as `~/.env.local`
- store a dedicated app secret file such as `~/Library/Application Support/SlackStatusCodexBar/.env.local`
- call an external secret command or keychain-backed helper at runtime

Confirm before storing a token anywhere. Do not put secrets in `config.json`, plist files, state files, logs, or docs.

## Build

Resolve this skill directory first. Do not hardcode local checkout paths.

```bash
cd <SKILL_ROOT>
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Deploy the built files into `~/Library/Application Support/SlackStatusCodexBar/`.

Required runtime files:

- `hook.mjs`
- `hook.sh`
- `config.json`
- `format.mjs` if the user wants a custom formatter

Default `config.json`:

```json
{
  "version": 2,
  "probeIntervalMs": 60000,
  "throttleIntervalMs": 30000,
  "statusLeaseSeconds": 0,
  "codexbar": {
    "command": "codexbar",
    "timeoutMs": 45000,
    "providerSelection": "enabled",
    "sourceMode": "default",
    "widgetSnapshotPath": null,
    "widgetSnapshotMaxAgeMs": 600000
  },
  "launchd": {
    "label": "dev.vdustr.slack-status-codexbar",
    "startIntervalSeconds": 300
  }
}
```

`hook.sh` should execute with absolute tool paths discovered during setup. Do not rely on launchd inheriting an interactive shell PATH.

```bash
#!/usr/bin/env bash
set -euo pipefail
exec "<ABSOLUTE_NODE_PATH>" "$HOME/Library/Application Support/SlackStatusCodexBar/hook.mjs" "$@"
```

If the Slack token is stored in `~/.env.local`, use the `vp-env-secrets` helper instead of writing the token into the plist or config. The wrapper must also set a fixed PATH that includes `dotenvx`, because launchd's default PATH is minimal:

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH="<DOTENVX_BIN_DIR>:<MISE_SHIMS_DIR>:<BREW_BIN_DIR>:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
APP_HOME="${SLACK_STATUS_CODEXBAR_HOME:-$HOME/Library/Application Support/SlackStatusCodexBar}"
exec "<ENVCTL_PATH>" run --cwd "$APP_HOME" --home "$HOME" -- "<ABSOLUTE_NODE_PATH>" "$APP_HOME/hook.mjs" "$@"
```

For LaunchAgent installs, set `codexbar.command` in the deployed `config.json` to the absolute `codexbar` path discovered during setup. This avoids depending on launchd PATH for fallback diagnostics while still inheriting CodexBar provider settings.

## LaunchAgent

Generate the plist from the deployed runtime:

```bash
node "$HOME/Library/Application Support/SlackStatusCodexBar/hook.mjs" launchd-plist > "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
```

Load it:

```bash
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
```

Run a dry refresh before enabling or after changes:

```bash
node "$HOME/Library/Application Support/SlackStatusCodexBar/hook.mjs" refresh --dry-run
```

## Formatter

If no custom formatter exists, the built-in formatter produces a compact provider summary, for example:

```text
Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00
```

The built-in formatter hides providers that only return errors. It appends reset time with `@` for each displayed rate-limit window when the CodexBar widget snapshot or CLI provides `resetDescription` or `resetsAt`; if CodexBar only provides `windowMinutes`, it shows an approximate label such as `@~5h`.

If CodexBar returns no usable provider windows or credit data, skip the Slack profile update. Do not write a placeholder unavailable status.

Emoji style is user-facing. Discuss it with the user before changing the default or adding a custom formatter. The built-in formatter continues the original Claude Slack status style: `:battery:`, `:low_battery:`, `:warning:`, and `:no_entry:`. It preserves the original per-window threshold logic: short windows use `40/20` low/warning thresholds, seven-day windows use `29/14`, and the final emoji comes from the most severe usable rate-limit window across displayed providers; error-only providers are ignored after filtering.

Custom `format.mjs` may export:

```javascript
export function formatStatus(snapshot) {
  return {
    statusText: "...",
    statusEmoji: ":large_green_circle:",
  };
}
```

The `snapshot` is the aggregate CodexBar snapshot, not a Claude-only quota object.

## Uninstall

Do not remove unrelated user files.

```bash
launchctl bootout "gui/$UID" "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
rm "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
```

Ask before deleting `~/Library/Application Support/SlackStatusCodexBar/` or logs.

## Scope

No migration is implemented. If an older Claude-specific Slack status integration exists, report that it may compete for Slack status writes and ask the user to disable it manually.
