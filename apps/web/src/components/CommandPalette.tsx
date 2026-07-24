"use client";

import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";

import { OpenAddProjectCommandPaletteProvider } from "../commandPaletteContext";
import { ComposerHandleContext } from "../composerHandleContext";
import { resolveShortcutCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import type { CommandPaletteOpenIntent } from "./CommandPaletteDialog";
import { CommandDialog, CommandDialogPopup } from "./ui/command";

const CommandPaletteDialog = lazy(() =>
  import("./CommandPaletteDialog").then((module) => ({
    default: module.CommandPaletteDialog,
  })),
);

function CommandPaletteLoadingFallback() {
  return (
    <CommandDialogPopup
      aria-busy="true"
      aria-label="Loading command palette"
      className="overflow-hidden p-0"
      data-command-palette="true"
      data-testid="command-palette-loading"
      finalFocus={() => false}
      tabIndex={-1}
    >
      <div className="border bg-popover px-4 py-3 text-muted-foreground text-sm" role="status">
        Loading commands…
      </div>
    </CommandDialogPopup>
  );
}

interface CommandPaletteUiState {
  readonly open: boolean;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "Toggle" }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "ClearOpenIntent" };

function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return {
        open: action.open,
        openIntent: action.open ? state.openIntent : null,
      };
    case "Toggle":
      return { open: !state.open, openIntent: null };
    case "OpenAddProject":
      return { open: true, openIntent: { kind: "add-project" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    openIntent: null,
  });
  const setOpen = useCallback((open: boolean) => dispatch({ _tag: "SetOpen", open }), []);
  const toggleOpen = useCallback(() => dispatch({ _tag: "Toggle" }), []);
  const openAddProject = useCallback(() => dispatch({ _tag: "OpenAddProject" }), []);
  const clearOpenIntent = useCallback(() => dispatch({ _tag: "ClearOpenIntent" }), []);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });
      if (command !== "commandPalette.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, terminalOpen, toggleOpen]);

  return (
    <OpenAddProjectCommandPaletteProvider openAddProject={openAddProject}>
      <ComposerHandleContext value={composerHandleRef}>
        <CommandDialog open={state.open} onOpenChange={setOpen}>
          {children}
          {state.open ? (
            <Suspense fallback={<CommandPaletteLoadingFallback />}>
              <CommandPaletteDialog
                openIntent={state.openIntent}
                setOpen={setOpen}
                clearOpenIntent={clearOpenIntent}
              />
            </Suspense>
          ) : null}
        </CommandDialog>
      </ComposerHandleContext>
    </OpenAddProjectCommandPaletteProvider>
  );
}
