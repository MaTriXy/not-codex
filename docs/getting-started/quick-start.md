# Quick start

```bash
# Development (with hot reload)
vp run dev

# Desktop development
vp run dev:desktop

# Desktop development on an isolated port set
NOT_CODEX_DEV_INSTANCE=feature-xyz vp run dev:desktop

# Production
vp run build
vp run start

# Build a shareable macOS .dmg (arm64 by default)
vp run dist:desktop:dmg

# Or from any project directory after publishing:
npx notcodex@latest
```

Install and authenticate at least one supported provider before starting. See the
[provider guides](../providers/codex.md) and the root [README](../../README.md) for the current list.
