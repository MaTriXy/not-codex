# Pi provider

Not Codex supports Pi as a first-class provider through Pi's native RPC mode. Install Pi 0.80.4 or
newer and authenticate at least one upstream model provider:

```bash
npm install -g @earendil-works/pi-coding-agent
pi auth login
```

The provider discovers Pi's configured models, skills, and slash commands dynamically. Model slugs
use Pi's `provider/model` form. Each Not Codex thread owns one persistent Pi process and stores a
versioned cursor containing Pi's session id, session file, and latest tree leaf when available.

Pi delegates tool authorization to extensions. Not Codex loads a generated permission bridge that
maps its runtime modes as follows:

- **Approval required** asks before every Pi tool call.
- **Auto-accept edits** allows file reads and edits but asks for commands and other tools.
- **Full access** runs tools without approval prompts.

Project-local Pi settings, extensions, skills, prompts, and context files are ignored by default.
Enable **Project resources** in the Pi provider settings only for repositories you trust; Pi
extensions execute with the Pi process permissions.

Pi does not expose a native plan-mode contract, so Not Codex hides the plan toggle for Pi sessions.
Rollback uses Pi's append-only session tree to fork at an earlier user message and persists the new
session cursor for restart-safe recovery.
