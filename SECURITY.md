# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/MaTriXy/not-codex/security/advisories/new)
to send the maintainers a private report. Include:

- the affected version or commit;
- clear reproduction steps or a minimal proof of concept;
- the security impact you believe is possible; and
- any suggested mitigation, if you have one.

We will acknowledge a complete report as soon as practical, investigate it, and keep
the reporter informed when there is a meaningful status change. Please allow time for a
fix and coordinated disclosure before publishing details.

## Scope

Security-sensitive areas include provider credentials and sessions, local filesystem
and shell access, remote access and pairing, the Connect relay, update and release
signing, source-control credentials, and automation policies.

Not Codex controls coding agents that may execute commands and modify files. Only open
trusted repositories, review permission prompts, and use the least-permissive runtime
mode that can complete the task. Never include secrets in issues, logs, screenshots, or
test fixtures.

## Supported Versions

Not Codex is an early-stage project. Security fixes are made on the latest release and
the current `main` branch. Older builds may not receive patches.

## Independence

Not Codex is an independent project. Reports about OpenAI Codex, Claude Code, Cursor,
OpenCode, or another provider should also be sent to that provider when the issue is in
their software rather than in Not Codex.
