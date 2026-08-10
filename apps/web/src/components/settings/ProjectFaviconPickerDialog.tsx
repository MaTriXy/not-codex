import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@notcodex/contracts";
import { useMemo, useState } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";
import { useTheme } from "~/hooks/useTheme";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandPanel,
} from "../ui/command";

const PROJECT_FILE_PICKER_RESULT_LIMIT = 200;

function emptyMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  if (isPending) return query.trim() ? "Searching project files…" : "Indexing project files…";
  return query.trim() ? "No matching image files." : "No image files found.";
}

export function ProjectFaviconPickerDialog(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (path: string) => void;
  readonly open: boolean;
  readonly projectName: string;
}) {
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const result = useProjectFilePickerQuery(
    props.environmentId,
    props.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
    { imageOnly: true },
  );
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      result.entries.map((entry) => ({
        kind: "action",
        value: `project-favicon:${entry.path}`,
        searchTerms: [entry.path],
        title: entry.path.split("/").at(-1) ?? entry.path,
        description: entry.path,
        icon: <PierreEntryIcon pathValue={entry.path} kind="file" theme={resolvedTheme} />,
        run: async () => props.onSelect(entry.path),
      })),
    [props.onSelect, resolvedTheme, result.entries],
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <CommandDialogPopup
          aria-label="Choose project icon"
          className="overflow-hidden p-0"
          onBackdropPointerDown={() => props.onOpenChange(false)}
        >
          <Command
            aria-label="Choose project icon"
            autoHighlight="always"
            mode="none"
            onItemHighlighted={(value) => {
              setHighlightedItemValue(typeof value === "string" ? value : null);
            }}
            onValueChange={(value) => {
              setHighlightedItemValue(null);
              setQuery(value);
            }}
            value={query}
          >
            <CommandInput placeholder="Search image files…" />
            <CommandPanel className="max-h-[min(34rem,76vh)]" data-testid="project-favicon-picker">
              <CommandPaletteResults
                groups={
                  items.length > 0
                    ? [{ value: "project-favicon-files", label: props.projectName, items }]
                    : []
                }
                highlightedItemValue={highlightedItemValue}
                isActionsOnly={false}
                keybindings={keybindings}
                onExecuteItem={(item) => {
                  if (item.kind !== "action") return;
                  props.onOpenChange(false);
                  void item.run();
                }}
                emptyStateMessage={emptyMessage(query, result.error, result.isPending)}
              />
            </CommandPanel>
          </Command>
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}
