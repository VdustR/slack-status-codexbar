# Uninstall Reference

Use this when removing a real LaunchAgent install.

## Stop LaunchAgent

Check whether the service exists before unloading it:

```bash
launchctl print "gui/$UID/dev.vdustr.slack-status-codexbar"
```

Unload only this service:

```bash
launchctl bootout "gui/$UID" "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
```

Remove only this plist:

```bash
rm "$HOME/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist"
```

## Runtime Files

Ask before deleting:

- `~/Library/Application Support/SlackStatusCodexBar/`
- `~/Library/Logs/SlackStatusCodexBar/`

If a dedicated app secret file exists, ask separately before deleting it. Do not delete or modify home-level env files such as `~/.env.local` unless the user explicitly requests that specific cleanup.

## Slack Status

Uninstalling the LaunchAgent stops future writes. It does not automatically clear or restore the user's Slack status unless the user explicitly asks for that behavior.
