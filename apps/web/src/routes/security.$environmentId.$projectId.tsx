import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectSecurityPage } from "../components/security/ProjectSecurityPage";
import { EnvironmentId, ProjectId } from "@notcodex/contracts";
import { SidebarInset } from "../components/ui/sidebar";

function SecurityRouteView() {
  const { environmentId: rawEnvironmentId, projectId: rawProjectId } = Route.useParams();
  const environmentId = EnvironmentId.make(rawEnvironmentId);
  const projectId = ProjectId.make(rawProjectId);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <ProjectSecurityPage environmentId={environmentId} projectId={projectId} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/security/$environmentId/$projectId")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: SecurityRouteView,
});
