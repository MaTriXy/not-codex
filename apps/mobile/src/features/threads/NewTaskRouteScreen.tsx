import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { SymbolView } from "../../components/AppSymbol";
import { EnvironmentId, type ProjectId } from "@notcodex/contracts";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "../../lib/useThemeColor";
import { cn } from "../../lib/cn";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { useEnvironmentShellState, useProjects, useThreadShells } from "../../state/entities";
import type { WorkspaceState } from "../../state/workspaceModel";
import { useWorkspaceState } from "../../state/workspace";
import { groupProjectsByRepository } from "../../lib/repositoryGroups";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import {
  isRequestedProjectCatalogLoading,
  shouldReleaseMissingProjectReservation,
} from "./project-catalog-loading";

type NewTaskRouteParams = {
  readonly incomingShareId?: string | string[];
};

function deriveProjectEmptyState(catalogState: WorkspaceState): {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
} {
  if (catalogState.isLoadingConnections) {
    return {
      title: "Loading environments",
      detail: "Checking saved environments on this device.",
      loading: true,
    };
  }

  if (!catalogState.hasConnections) {
    return {
      title: "No environments connected",
      detail: "Add an environment before creating a task.",
      loading: false,
    };
  }

  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error") &&
    !catalogState.hasLoadedShellSnapshot
  ) {
    return {
      title: "Environment unavailable",
      detail:
        catalogState.connectionError ??
        "The saved environment is offline. Check the URL or start the environment, then retry.",
      loading: false,
    };
  }

  if (
    catalogState.hasConnectingEnvironment &&
    !catalogState.hasLoadedShellSnapshot &&
    catalogState.connectionError === null
  ) {
    return {
      title: "Connecting to environment",
      detail: "Loading projects from the saved environment.",
      loading: true,
    };
  }

  return {
    title: "No projects found",
    detail: "The connected environment did not report any projects.",
    loading: false,
  };
}

export function NewTaskRouteScreen({ route }: StaticScreenProps<NewTaskRouteParams | undefined>) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { layout } = useAdaptiveWorkspaceLayout();
  const insets = useSafeAreaInsets();
  const chevronColor = useThemeColor("--color-chevron");
  const accentColor = useThemeColor("--color-icon-muted");
  const { getShare, releaseShareReservation } = useIncomingShare();
  const routeShareId = Array.isArray(route.params?.incomingShareId)
    ? route.params.incomingShareId[0]
    : route.params?.incomingShareId;
  const incomingShare = routeShareId ? getShare(routeShareId) : null;
  const incomingShareSubtitle = incomingShare
    ? incomingShare.attachments.length === 0
      ? "Choose a project for what you shared"
      : incomingShare.attachments.length === 1
        ? "Choose a project for the image you shared"
        : `Choose a project for the ${incomingShare.attachments.length} images you shared`
    : null;
  const screenTitle = incomingShare ? "Start a task" : "Choose project";
  const repositoryGroups = useMemo(
    () => groupProjectsByRepository({ projects, threads }),
    [projects, threads],
  );
  const items = useMemo(() => {
    const nextItems: Array<{
      readonly environmentId: EnvironmentId;
      readonly id: ProjectId;
      readonly key: string;
      readonly title: string;
      readonly workspaceRoot: string;
    }> = [];
    for (const group of repositoryGroups) {
      const project = group.projects[0]?.project;
      if (!project) {
        continue;
      }
      nextItems.push({
        environmentId: project.environmentId,
        id: project.id,
        key: group.key,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
      });
    }
    return nextItems;
  }, [repositoryGroups]);
  const projectEmptyState = deriveProjectEmptyState(catalogState);
  const resumedDestinationKeyRef = useRef<string | null>(null);
  const reservedDestinationProject = incomingShare?.destination
    ? (projects.find(
        (project) =>
          project.environmentId === incomingShare.destination?.environmentId &&
          project.id === incomingShare.destination?.projectId,
      ) ?? null)
    : null;
  const reservedDestinationEnvironmentId = incomingShare?.destination
    ? EnvironmentId.make(incomingShare.destination.environmentId)
    : null;
  const reservedDestinationEnvironment = reservedDestinationEnvironmentId
    ? (workspaceEnvironments.find(
        (environment) => environment.environmentId === reservedDestinationEnvironmentId,
      ) ?? null)
    : null;
  const reservedDestinationShell = useEnvironmentShellState(
    reservedDestinationEnvironment === null ? null : reservedDestinationEnvironmentId,
  );
  const reservedDestinationCatalogState = {
    catalogIsLoadingConnections: catalogState.isLoadingConnections,
    environment: reservedDestinationEnvironment,
    shellStatus: reservedDestinationShell.status,
    hasShellSnapshot: Option.isSome(reservedDestinationShell.snapshot),
    shellError: Option.isSome(reservedDestinationShell.error),
  };
  const isReservedDestinationCatalogLoading = Boolean(
    incomingShare?.destination &&
    !reservedDestinationProject &&
    isRequestedProjectCatalogLoading(reservedDestinationCatalogState),
  );

  async function releaseStaleShareReservation(): Promise<boolean> {
    if (incomingShare?.destination && !reservedDestinationProject) {
      if (
        !shouldReleaseMissingProjectReservation({
          catalogState: reservedDestinationCatalogState,
        })
      ) {
        return false;
      }
      try {
        await releaseShareReservation(incomingShare.id, incomingShare.destination);
      } catch (error) {
        Alert.alert(
          "Could not change project",
          error instanceof Error
            ? error.message
            : "The shared content reservation could not be updated.",
        );
        return false;
      }
    }
    return true;
  }

  async function selectProject(item: (typeof items)[number]): Promise<void> {
    if (!(await releaseStaleShareReservation())) {
      return;
    }
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: {
        environmentId: item.environmentId,
        projectId: item.id,
        title: item.title,
        incomingShareId: incomingShare?.id,
      },
    });
  }

  async function openAddProject(): Promise<void> {
    if (!(await releaseStaleShareReservation())) {
      return;
    }
    navigation.navigate("NewTaskSheet", {
      screen: "AddProject",
      params: incomingShare ? { incomingShareId: incomingShare.id } : undefined,
    });
  }

  useEffect(() => {
    const destination = incomingShare?.destination;
    if (!destination) {
      resumedDestinationKeyRef.current = null;
      return;
    }
    if (!isFocused) {
      // Returning from the reserved draft is a fresh resume attempt. Keeping
      // this latch set would leave every project row disabled with no route.
      resumedDestinationKeyRef.current = null;
      return;
    }
    const destinationKey = `${incomingShare.id}:${destination.environmentId}:${destination.projectId}`;
    if (resumedDestinationKeyRef.current === destinationKey) {
      return;
    }
    if (!reservedDestinationProject) {
      return;
    }
    resumedDestinationKeyRef.current = destinationKey;
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: {
        environmentId: reservedDestinationProject.environmentId,
        projectId: reservedDestinationProject.id,
        title: reservedDestinationProject.title,
        incomingShareId: incomingShare.id,
      },
    });
  }, [incomingShare, isFocused, navigation, reservedDestinationProject]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          {/* Android renders its own in-screen header instead of the native bar. */}
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title={screenTitle}
            subtitle={incomingShareSubtitle}
            onBack={layout.usesSplitView ? () => navigation.goBack() : undefined}
            actions={[
              {
                accessibilityLabel: "Add project",
                disabled: isReservedDestinationCatalogLoading,
                icon: "plus",
                onPress: () => void openAddProject(),
              },
            ]}
          />
        </>
      ) : (
        <>
          <NativeStackScreenOptions
            options={{
              title: screenTitle,
              unstable_headerSubtitle: incomingShareSubtitle ?? undefined,
            }}
          />
          <NativeHeaderToolbar placement="right">
            {layout.usesSplitView ? (
              <NativeHeaderToolbar.Button
                accessibilityLabel="Close new task"
                icon="xmark"
                onPress={() => navigation.goBack()}
                separateBackground
              />
            ) : null}
            <NativeHeaderToolbar.Button
              disabled={isReservedDestinationCatalogLoading}
              icon="plus"
              onPress={() => void openAddProject()}
              separateBackground
            />
          </NativeHeaderToolbar>
        </>
      )}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: 8,
        }}
      >
        {items.length === 0 ? (
          <View collapsable={false} className="items-center gap-3 rounded-[24px] bg-card px-6 py-8">
            {projectEmptyState.loading ? <ActivityIndicator color={accentColor} /> : null}
            <Text className="text-center text-lg font-notcodex-bold text-foreground">
              {projectEmptyState.title}
            </Text>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              {projectEmptyState.detail}
            </Text>
            {!catalogState.hasReadyEnvironment ? (
              <Pressable
                className="mt-1 rounded-full bg-primary px-4 py-2.5 active:opacity-70"
                onPress={() =>
                  navigation.navigate(
                    "ConnectionsNew",
                    incomingShare ? { incomingShareId: incomingShare.id } : undefined,
                  )
                }
              >
                <Text className="text-sm font-notcodex-bold text-primary-foreground">
                  Add environment
                </Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={isReservedDestinationCatalogLoading}
                className="mt-1 rounded-full bg-primary px-4 py-2.5 active:opacity-70"
                onPress={() => void openAddProject()}
              >
                <Text className="text-sm font-notcodex-bold text-primary-foreground">
                  Add new project
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View collapsable={false} className="overflow-hidden rounded-[24px] bg-card">
            {items.map((item, index) => {
              const isFirst = index === 0;
              const isLast = index === items.length - 1;

              return (
                <Pressable
                  key={item.key}
                  disabled={
                    reservedDestinationProject !== null || isReservedDestinationCatalogLoading
                  }
                  onPress={() => void selectProject(item)}
                  className={cn(
                    "bg-card px-4 py-3.5",
                    !isFirst && "border-t border-border-subtle",
                    isFirst && "rounded-t-[24px]",
                    isLast && "rounded-b-[24px]",
                  )}
                >
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="h-7 w-7 items-center justify-center">
                      <ProjectFavicon
                        environmentId={item.environmentId}
                        size={20}
                        projectTitle={item.title}
                        workspaceRoot={item.workspaceRoot}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base leading-snug font-notcodex-bold">
                        {item.title}
                      </Text>
                    </View>
                    <SymbolView
                      name="chevron.right"
                      size={14}
                      tintColor={chevronColor}
                      type="monochrome"
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
