import { ChartNoAxesColumnIcon, HistoryIcon, SettingsIcon, WorkflowIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { resolveSidebarStageBackdropVariant, useSidebarStageLabel } from "../SidebarStage";
import { SidebarStageBackdrop } from "../SidebarStageBackdrop";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useSidebarStageLabel();
  const backdropVariant = resolveSidebarStageBackdropVariant(stageLabel);

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant && "hover:bg-white/15 [&_svg]:text-white/85! [&_svg]:hover:text-white!",
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} stageLabel={stageLabel} />
    </SidebarHeader>
  );
});

function SidebarBrand({ stageLabel, onBackdrop }: { stageLabel: string; onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "sidebar-brand relative z-10 ml-[var(--workspace-titlebar-content-left)] h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <img src="/favicon-32x32.png" alt="" className="size-4 shrink-0" />
      <span
        className={cn(
          "truncate text-sm font-medium tracking-tight",
          onBackdrop ? "text-white/80" : "text-muted-foreground",
        )}
      >
        Not Codex
      </span>
      <span
        className={cn(
          "sidebar-brand-stage shrink-0 items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em]",
          onBackdrop
            ? "bg-white/15 text-white/80 backdrop-blur-sm"
            : "bg-muted/50 text-muted-foreground/60",
        )}
      >
        {stageLabel}
      </span>
    </Link>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const navigateFromSidebar = useCallback(
    (to: "/runs" | "/automations" | "/settings" | "/usage") => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to });
    },
    [isMobile, navigate, setOpenMobile],
  );

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={() => navigateFromSidebar("/usage")}
          >
            <ChartNoAxesColumnIcon className="size-3.5" />
            <span className="text-xs">Usage</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={() => navigateFromSidebar("/runs")}
          >
            <HistoryIcon className="size-3.5" />
            <span className="text-xs">Runs</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={() => navigateFromSidebar("/automations")}
          >
            <WorkflowIcon className="size-3.5" />
            <span className="text-xs">Automations</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={() => navigateFromSidebar("/settings")}
          >
            <SettingsIcon className="size-3.5" />
            <span className="text-xs">Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
