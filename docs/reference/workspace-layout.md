# Workspace layout

- `/apps/server`: Node.js environment server. Owns provider adapters and sessions, event-sourced orchestration, persistence, VCS workflows, terminals, previews, HTTP, and WebSocket RPC.
- `/apps/web`: React + Vite UI. Owns project/thread UX, conversation and activity rendering, repository workflows, settings, and responsive client state.
- `/apps/desktop`: Electron shell. Spawns a desktop-scoped `notcodex` backend process and loads the shared web app.
- `/apps/mobile`: Expo/React Native companion for remote threads, approvals, and live status.
- `/packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types.
- `/packages/client-runtime`: Shared connection, RPC, authorization, and client-state runtime used across clients.
- `/packages/shared`: Shared runtime utilities consumed by server and clients. Uses explicit subpath exports (e.g. `@notcodex/shared/git`, `@notcodex/shared/DrainableWorker`) — no barrel index.
- `/infra/relay`: Optional Not Codex Connect relay infrastructure. It coordinates reachability and status; it does not execute coding-agent turns.
