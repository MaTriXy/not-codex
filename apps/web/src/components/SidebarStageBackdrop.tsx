import type { SidebarStageBackdropVariant } from "./SidebarStage";

function NotCodexStageMark() {
  return (
    <div className="sidebar-stage-mark" data-stage-mark="">
      <span data-stage-tile="shell" />
      <span data-stage-tile="prompt" />
      <span data-stage-tile="cursor" />
    </div>
  );
}

/** Channel-specific artwork derived from the independent Not Codex terminal mark. */
export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop relative h-full w-full overflow-hidden"
      data-stage-variant={variant}
    >
      <NotCodexStageMark />
    </div>
  );
}

export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-20 overflow-hidden select-none"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}
