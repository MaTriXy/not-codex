import { createFileRoute, redirect } from "@tanstack/react-router";

import { IntegrationRunsPage } from "../components/integrations/IntegrationRunsPage";
import { SidebarInset } from "../components/ui/sidebar";

function RunsRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <IntegrationRunsPage />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/runs/")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: RunsRouteView,
});
