export const APP_NAME = "SlackStatusCodexBar";
export const HOOK_EVENTS = ["SessionStart", "Stop", "StopFailure", "SessionEnd"] as const;
export const HOOK_MARKER = "slack-status-codexbar";
export const LAUNCH_AGENT_LABEL = "dev.vdustr.slack-status-codexbar";

export const KEYCHAIN_SERVICE = "Claude Code-credentials";
export const KEYCHAIN_ACCOUNT_FALLBACK = "default";
export const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_SCOPES = "user:profile user:inference user:sessions:claude_code";
export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
export const SLACK_API_BASE_URL = "https://slack.com/api";
