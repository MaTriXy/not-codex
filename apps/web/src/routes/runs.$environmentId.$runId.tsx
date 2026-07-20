import { createFileRoute, redirect } from "@tanstack/react-router";

import { IntegrationRunReceipt } from "../components/integrations/IntegrationRunReceipt";
import { SidebarInset } from "../components/ui/sidebar";

function IntegrationRunRouteView() {
  const { environmentId, runId } = Route.useParams();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <IntegrationRunReceipt key={runId} environmentId={environmentId} runId={runId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/runs/$environmentId/$runId")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: IntegrationRunRouteView,
});
