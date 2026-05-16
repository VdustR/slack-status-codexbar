# Secret Handling Reference

SlackStatusCodexBar must keep secrets separate from normal runtime settings.

## Rules

- Do not store Slack tokens in `config.json`.
- Do not put Slack tokens in LaunchAgent plist files.
- Do not write Slack tokens to state, logs, docs, commit messages, or chat.
- Do not print raw secret values while checking or debugging.
- Use `vp-env-secrets` for `.env*` discovery, staging, and command injection.

## User Choice

Before configuring a real install, ask how the user wants the Slack token obtained at runtime:

- Reuse an existing user env source such as `~/.env.local`.
- Store a dedicated app secret file such as `~/Library/Application Support/SlackStatusCodexBar/.env.local`.
- Call an external secret command or keychain-backed helper from `hook.sh`.

Confirm the choice before storing or copying any secret.

## Env File Pattern

When using `.env*` files, run commands through `vp-env-secrets/scripts/envctl run` instead of sourcing files manually.

For an existing home env source:

```bash
<ENVCTL_PATH> run --cwd "$APP_HOME" --home "$HOME" -- <ABSOLUTE_NODE_PATH> "$APP_HOME/hook.mjs" refresh
```

For a dedicated app-local secret file, place it in the runtime home as `.env.local` with restrictive permissions. Keep it separate from `config.json` and never commit it.

## Launchd PATH

launchd uses a minimal PATH. If `envctl` depends on `dotenvx`, the wrapper must set a fixed PATH that includes the `dotenvx` binary directory before calling `envctl`.

## Validation

Validation should prove only presence and behavior:

- `envctl list --keys` can show key names and risk flags.
- A dry run through the launchd wrapper succeeds.
- A real refresh writes Slack status.

Never validate by printing the token value.
