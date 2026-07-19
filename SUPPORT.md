# Support

Not Codex is an early open-source project and does not guarantee support response times.

- Search [existing issues](https://github.com/MaTriXy/not-codex/issues) before opening a report.
- Use the bug form for reproducible defects and the feature form for scoped proposals.
- Use [GitHub private vulnerability reporting](https://github.com/MaTriXy/not-codex/security/advisories/new)
  for security issues; never disclose them in a public issue.

Include the Not Codex version or commit, operating system, provider, relevant logs, and the smallest
reproduction you can provide. Remove tokens, credentials, repository secrets, and private source before
posting.

For integration reports, also include:

- the integration name and version shown in **Settings → Integrations**;
- a sanitized Monkey.D.Loopy or LoopAny run ID;
- validation diagnostics or the terminal error message;
- whether the failure happened during validation, delivery, agent execution, or reporting; and
- a redacted journal path when reporting a Monkey.D.Loopy recovery issue.

Never post LoopAny device tokens, run-scoped tokens, provider credentials, full private LoopSpecs,
private prompts, repository contents, or raw server secret-store files. If a report cannot be safely
redacted, use private vulnerability reporting instead of a public issue.
