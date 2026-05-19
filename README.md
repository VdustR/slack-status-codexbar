# slack-status-codexbar

Unofficial Slack status integration powered by CodexBar.

SlackStatusCodexBar runs the CodexBar CLI and syncs a compact multi-provider summary into your Slack custom status.

Slack renders the emoji separately from the status text. With the built-in formatter, a healthy status appears like this in Slack:

```text
🔋 Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00
```

## Design

- Agent-neutral: not tied to Claude Code, Codex, or any single provider.
- CodexBar-owned provider configuration: enabled providers, source mode, token accounts, cookies, OAuth, API keys, and provider order are inherited from CodexBar CLI defaults, with optional provider-specific CLI source overrides.
- LaunchAgent-based ambient refresh: macOS `launchd` runs refresh on an interval so the status remains active after setup.
- Slack-only ownership: this project handles Slack profile writes, throttling, ownership checks, logs, and formatting.
- No auto-expiration by default: Slack `status_expiration` is `0`.

By default refresh runs:

```bash
codexbar usage --format json --json-only
```

The primary command intentionally does not pass `--provider` or `--source`, so CodexBar decides the enabled providers and source mode. The default config also runs a provider-specific CLI override for Claude:

```bash
codexbar usage --provider claude --source oauth --format json --json-only
```

The Claude override matches CodexBar app behavior for accounts where the CLI's default Claude web source can report stale zero usage. This integration still stays CLI-only and does not read CodexBar's widget snapshot cache or app group container.

When the Gemini provider uses CLI OAuth under `launchd`, set `codexbar.geminiCliPath` to the real Gemini CLI binary path discovered during setup. SlackStatusCodexBar passes it to CodexBar as `GEMINI_CLI_PATH`, so CodexBar can refresh expired Gemini OAuth credentials without relying on an interactive shell PATH.

## Slack Status Examples

The built-in formatter writes Slack profile fields like:

```json
{
  "status_emoji": ":battery:",
  "status_text": "Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00",
  "status_expiration": 0
}
```

Slack then displays the emoji and text together:

| Slack display | `status_emoji` | Example `status_text` | Meaning |
| --- | --- | --- | --- |
| 🔋 Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00 | `:battery:` | `Codex 53%@18:34/46%@5/19 08:10 · Claude 65%@5/16 20:00/90%@5/23 05:00` | Healthy quota across displayed providers. |
| 🪫 Codex 27%@18:34/42%@5/19 08:11 | `:low_battery:` | `Codex 27%@18:34/42%@5/19 08:11` | A displayed window is low, but not critical. |
| ⚠️ Codex 15%@18:34/90%@5/19 08:10 | `:warning:` | `Codex 15%@18:34/90%@5/19 08:10` | A displayed short window is at the warning threshold. |
| ⛔ Codex 0%@18:34/42%@5/19 08:11 | `:no_entry:` | `Codex 0%@18:34/42%@5/19 08:11` | A displayed quota window is exhausted. |

`@18:34` and `@5/19 08:10` are compact reset labels. Approximate labels such as `@~5h` are used when CodexBar only reports the window duration.

## Runtime Paths

```text
~/Library/Application Support/SlackStatusCodexBar/
~/Library/Logs/SlackStatusCodexBar/
~/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist
```

## Prerequisites

- Node 22+
- `pnpm`
- CodexBar app configured with the desired providers
- CodexBar CLI installed as `codexbar`
- Real Gemini CLI binary path, when Gemini is enabled and installed through a shim manager such as mise
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

The built-in formatter hides providers that only return errors. Reset times are shown for each displayed rate-limit window when the CodexBar CLI provides `resetDescription` or `resetsAt`; if CodexBar only provides `windowMinutes`, the formatter shows an approximate label such as `@~5h`.

If CodexBar returns no usable provider windows or credit data, SlackStatusCodexBar skips the Slack profile update instead of writing an unavailable status. For `refresh --dry-run`, this returns `ok: false` with `profile: null`.

Default emoji continue the original Claude Slack status style: 🔋 `:battery:`, 🪫 `:low_battery:`, ⚠️ `:warning:`, and ⛔ `:no_entry:`. Short windows use the original `40/20` low/warning thresholds, seven-day windows use `29/14`, and the chosen emoji comes from the most severe displayed quota window.

## License

MIT
