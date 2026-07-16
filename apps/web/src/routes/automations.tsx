import { createFileRoute, redirect } from "@tanstack/react-router";

import { AutomationsPage } from "../components/automations/AutomationsPage";
import { SidebarInset } from "../components/ui/sidebar";

function AutomationsRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <AutomationsPage />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/automations")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: AutomationsRouteView,
});
