# slack-status-codexbar

Unofficial Slack status integration powered by CodexBar.

SlackStatusCodexBar reads CodexBar's local widget snapshot and syncs a compact multi-provider summary into your Slack custom status.

```text
Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00
```

## Design

- Agent-neutral: not tied to Claude Code, Codex, or any single provider.
- CodexBar-owned provider configuration: enabled providers, source mode, token accounts, cookies, OAuth, API keys, and provider order are inherited from CodexBar.
- LaunchAgent-based ambient refresh: macOS `launchd` runs refresh on an interval so the status remains active after setup.
- Slack-only ownership: this project handles Slack profile writes, throttling, ownership checks, logs, and formatting.
- No auto-expiration by default: Slack `status_expiration` is `0`.

By default refresh reads CodexBar's widget snapshot from the app group container:

```text
~/Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json
```

If the snapshot is missing, stale, or invalid, the integration falls back to:

```bash
codexbar usage --format json --json-only
```

The fallback intentionally does not pass `--provider` or `--source`.

## Runtime Paths

```text
~/Library/Application Support/SlackStatusCodexBar/
~/Library/Logs/SlackStatusCodexBar/
~/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist
```

## Prerequisites

- Node 22+
- `pnpm`
- CodexBar app installed and writing `widget-snapshot.json`
- CodexBar CLI installed as `codexbar` for fallback diagnostics
- Slack user token with `users.profile:read` and `users.profile:write`
  - `SLACK_STATUS_USER_TOKEN`, or
  - `SLACK_MCP_XOXP_TOKEN`

## Development

```bash
cd skills/slack-status-codexbar
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Useful local checks:

```bash
node dist/hook.mjs refresh --dry-run
node dist/hook.mjs launchd-plist
```

LaunchAgent wrappers should use absolute tool paths discovered during setup because launchd does not inherit the interactive shell PATH. If the Slack token is loaded from `~/.env.local`, wrap the command with `vp-env-secrets/scripts/envctl run` and set a fixed PATH that includes `dotenvx`.

Secrets must stay separate from normal runtime config. Do not store Slack tokens in `config.json`, plist files, state files, logs, or docs. Use an existing user env source, a dedicated secret env file, or a runtime secret command after confirming the user's preference.

## Notes

SlackStatusCodexBar does not migrate or remove older Claude-specific hook installations. If another tool is also writing your Slack status, disable it manually before enabling this integration.

The built-in formatter hides providers that only return errors. Reset times are shown for each displayed rate-limit window when the CodexBar widget snapshot or CLI provides `resetDescription` or `resetsAt`; if CodexBar only provides `windowMinutes`, the formatter shows an approximate label such as `@~5h`.

Default emoji continue the original Claude Slack status style: `:battery:`, `:low_battery:`, `:warning:`, and `:no_entry:`. Short windows use the original `40/20` low/warning thresholds, seven-day windows use `29/14`, and the chosen emoji comes from the most severe displayed quota window.

## License

MIT
