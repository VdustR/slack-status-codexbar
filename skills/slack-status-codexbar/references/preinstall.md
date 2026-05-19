# Preinstall Reference

Use this when preparing a real install. Keep the interaction short and let the LLM help the user install missing dependencies with their preferred toolchain.

## Checks

Verify these without printing secrets:

- Node 22 or newer is available.
- `pnpm` is available for building the skill runtime.
- CodexBar app is configured with the desired providers.
- `codexbar` is installed and runnable.
- `codexbar config validate` passes.
- `codexbar usage --provider claude --source oauth --format json --json-only` works when Claude is enabled.
- The real Gemini CLI binary path is known when Gemini is enabled through CLI OAuth. Use the package binary path, not a shim path.
- A Slack user token source exists, but do not print the value.

## Missing Dependencies

If a dependency is missing, explain what is missing and ask the user how they want it installed or configured. Do not embed long package-manager instructions in the skill; use the local platform conventions and official paths.

For launchd installs, resolve absolute paths for:

- Node runtime
- `codexbar`
- Gemini CLI, when Gemini is enabled through CLI OAuth
- `envctl`, when `.env*` files are used
- `dotenvx`, when `envctl` needs it under launchd

Do not proceed to a persistent LaunchAgent install until the dry run succeeds through the same wrapper that launchd will execute.
