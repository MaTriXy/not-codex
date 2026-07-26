import type { SidebarStageBackdropVariant } from "./SidebarStage";

/** Channel-specific artwork derived from the independent Not Codex terminal mark. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 overflow-hidden select-none"
      data-stage-variant={variant}
    >
      <div className="sidebar-stage-mark" data-stage-mark="">
        <span data-stage-tile="shell" />
        <span data-stage-tile="prompt" />
        <span data-stage-tile="cursor" />
      </div>
    </div>
  );
}
