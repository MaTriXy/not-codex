import type { RuntimeMode } from "@notcodex/contracts";
import { CheckIcon, type LucideIcon, LockIcon, LockOpenIcon, PenLineIcon } from "lucide-react";

import { cn } from "~/lib/utils";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { readonly label: string; readonly description: string; readonly icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

export function RuntimeModeMenuOption(props: {
  readonly mode: RuntimeMode;
  readonly selected: boolean;
}) {
  const option = runtimeModeConfig[props.mode];
  const OptionIcon = option.icon;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {option.label}
        </span>
        <span className="text-muted-foreground text-xs leading-4">{option.description}</span>
      </div>
      <CheckIcon
        aria-hidden="true"
        className={cn("size-4 text-blue-400", props.selected ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}
