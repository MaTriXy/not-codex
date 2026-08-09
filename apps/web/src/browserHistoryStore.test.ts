import { scopeThreadRef } from "@notcodex/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@notcodex/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT,
  BROWSER_HISTORY_MAX_PROJECTS,
  evictExcessProjects,
  migratePersistedBrowserHistoryState,
  normalizeHistoryUrl,
  recordVisitForThread,
  resetBrowserHistoryForTests,
  upsertHistoryEntry,
  useBrowserHistoryStore,
} from "./browserHistoryStore";

describe("browser history normalization and bounds", () => {
  it("normalizes URLs and removes embedded credentials", () => {
    expect(normalizeHistoryUrl("https://user:secret@example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(normalizeHistoryUrl("not a url")).toBeNull();
  });

  it("deduplicates local aliases and preserves the stable loopback URL", () => {
    const first = upsertHistoryEntry([], "http://localhost:5173/", 1);
    const next = upsertHistoryEntry(first, "http://127.0.0.1:5173/", 2);
    expect(next).toEqual([{ url: "http://localhost:5173/", lastVisitedAt: 2 }]);
  });

  it("bounds entries per project and evicts least-recent projects", () => {
    let entries: ReturnType<typeof upsertHistoryEntry> = [];
    for (let index = 0; index < BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT + 5; index += 1) {
      entries = upsertHistoryEntry(entries, `http://localhost:${3000 + index}/`, index);
    }
    expect(entries).toHaveLength(BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);

    const projects = Object.fromEntries(
      Array.from({ length: BROWSER_HISTORY_MAX_PROJECTS + 2 }, (_, index) => [
        `project-${index}`,
        [{ url: `https://example.com/${index}`, lastVisitedAt: index }],
      ]),
    );
    const evicted = evictExcessProjects(projects);
    expect(Object.keys(evicted)).toHaveLength(BROWSER_HISTORY_MAX_PROJECTS);
    expect(evicted).not.toHaveProperty("project-0");
  });

  it("drops malformed persisted entries", () => {
    expect(
      migratePersistedBrowserHistoryState({
        byProjectKey: {
          project: [
            { url: "https://example.com", lastVisitedAt: 10, title: "Example" },
            { url: "http://[invalid", lastVisitedAt: 20 },
            { url: "https://ignored.example", lastVisitedAt: Number.POSITIVE_INFINITY },
          ],
        },
      }),
    ).toEqual({
      byProjectKey: {
        project: [{ url: "https://example.com/", lastVisitedAt: 10, title: "Example" }],
      },
    });
  });
});

describe("thread-to-project history routing", () => {
  beforeEach(() => resetBrowserHistoryForTests());

  it("flushes visits recorded before the thread project is known", () => {
    const ref = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
    recordVisitForThread(ref, "http://localhost:5173/", 100);
    expect(useBrowserHistoryStore.getState().byProjectKey).toEqual({});

    useBrowserHistoryStore.getState().registerThreadProject(ref, "logical-project");
    expect(useBrowserHistoryStore.getState().byProjectKey).toEqual({
      "logical-project": [{ url: "http://localhost:5173/", lastVisitedAt: 100 }],
    });
  });
});
