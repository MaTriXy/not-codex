import type { EnvironmentId, ProviderDriverKind } from "@notcodex/contracts";
import { FolderGit2Icon, FolderIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";

const META_ICON_CLASS = "size-3 shrink-0 text-muted-foreground/70";

function Dot() {
  return <span className="shrink-0 text-muted-foreground/50">·</span>;
}

export function ThreadCommandSubtitle(props: {
  environmentId: EnvironmentId;
  projectCwd: string | null;
  projectFaviconPath?: string | null;
  projectTitle: string | null;
  branch: string | null;
  worktreePath: string | null;
  isCurrent: boolean;
  driverKind?: ProviderDriverKind | null;
  providerDisplayName?: string | null;
  className?: string;
}) {
  const isWorktree = props.worktreePath != null && props.worktreePath.trim().length > 0;
  const showProvider = props.driverKind != null && props.providerDisplayName;
  const projectLabel = props.projectTitle?.trim() || null;
  const branchLabel = props.branch?.trim() || null;

  if (!projectLabel && !branchLabel && !props.isCurrent && !showProvider) return null;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground/70",
        props.className,
      )}
    >
      {projectLabel ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          {props.projectCwd ? (
            <ProjectFavicon
              environmentId={props.environmentId}
              cwd={props.projectCwd}
              faviconPath={props.projectFaviconPath}
              className="size-3 shrink-0"
            />
          ) : null}
          <span className="min-w-0 truncate">{projectLabel}</span>
        </span>
      ) : null}

      {branchLabel ? (
        <>
          {projectLabel ? <Dot /> : null}
          <span className="inline-flex min-w-0 items-center gap-1">
            {isWorktree ? (
              <FolderGit2Icon className={META_ICON_CLASS} aria-hidden />
            ) : (
              <FolderIcon className={META_ICON_CLASS} aria-hidden />
            )}
            <span className="min-w-0 truncate">{branchLabel}</span>
          </span>
        </>
      ) : null}

      {showProvider && props.driverKind ? (
        <>
          {projectLabel || branchLabel ? <Dot /> : null}
          <ProviderInstanceIcon
            driverKind={props.driverKind}
            displayName={props.providerDisplayName ?? props.driverKind}
            iconClassName="size-3 shrink-0 opacity-70"
          />
        </>
      ) : null}

      {props.isCurrent ? (
        <>
          {projectLabel || branchLabel || showProvider ? <Dot /> : null}
          <span className="shrink-0">Current thread</span>
        </>
      ) : null}
    </span>
  );
}
