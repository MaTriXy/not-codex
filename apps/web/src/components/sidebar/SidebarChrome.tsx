import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  GitPullRequestIcon,
  HistoryIcon,
  SettingsIcon,
  WorkflowIcon,
} from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

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
          "-translate-y-px truncate text-sm font-medium tracking-tight",
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

function CompactFooterAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              className="size-8 w-8 justify-center gap-0 p-0 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
              onClick={onClick}
            >
              {children}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      location.pathname === "/usage"
        ? "usage"
        : location.pathname === "/pull-requests"
          ? "pull-requests"
          : null,
  });
  const { environments } = useEnvironments();
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const navigateFromSidebar = useCallback(
    (to: "/pull-requests" | "/runs" | "/automations" | "/settings" | "/usage") => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to });
    },
    [isMobile, navigate, setOpenMobile],
  );

  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarMenu className="flex-row items-center justify-between gap-0">
        {currentFooterPage ? (
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
              onClick={handleBackClick}
            >
              <ArrowLeftIcon className="size-3.5" />
              <span className="text-xs">Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          <>
            <CompactFooterAction label="Settings" onClick={() => navigateFromSidebar("/settings")}>
              <SettingsIcon className="size-4" />
            </CompactFooterAction>
            {pullRequestsSupported ? (
              <CompactFooterAction
                label="Pull requests"
                onClick={() => navigateFromSidebar("/pull-requests")}
              >
                <GitPullRequestIcon className="size-4" />
              </CompactFooterAction>
            ) : null}
            <CompactFooterAction label="Usage" onClick={() => navigateFromSidebar("/usage")}>
              <ChartNoAxesColumnIcon className="size-4" />
            </CompactFooterAction>
            <CompactFooterAction label="Runs" onClick={() => navigateFromSidebar("/runs")}>
              <HistoryIcon className="size-4" />
            </CompactFooterAction>
            <CompactFooterAction
              label="Automations"
              onClick={() => navigateFromSidebar("/automations")}
            >
              <WorkflowIcon className="size-4" />
            </CompactFooterAction>
          </>
        )}
        <SidebarUpdatePill />
      </SidebarMenu>
    </SidebarFooter>
  );
});
