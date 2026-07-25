export interface IncomingSharePresentationState {
  readonly presentedShareId: string | null;
  readonly dismissedShareId: string | null;
}

export interface IncomingSharePresentationTransition {
  readonly state: IncomingSharePresentationState;
  readonly shareIdToPresent: string | null;
  readonly shareIdDismissed: string | null;
}

export const EMPTY_INCOMING_SHARE_PRESENTATION_STATE: IncomingSharePresentationState = {
  presentedShareId: null,
  dismissedShareId: null,
};

export function isIncomingShareFlowMounted(input: {
  readonly rootRouteNames: ReadonlyArray<string>;
  readonly topRouteName: string | undefined;
  readonly topRouteIncomingShareId: string | null;
  readonly presentedShareId: string | null;
}): boolean {
  if (input.rootRouteNames.includes("NewTaskSheet")) {
    return true;
  }
  return (
    input.topRouteName === "ConnectionsNew" &&
    input.presentedShareId !== null &&
    input.topRouteIncomingShareId === input.presentedShareId
  );
}

export function selectPendingIncomingShareId(
  orderedShareIds: ReadonlyArray<string>,
  dismissedShareIds: ReadonlySet<string>,
): string | null {
  return orderedShareIds.find((shareId) => !dismissedShareIds.has(shareId)) ?? null;
}

/**
 * Tracks presentation by durable share id rather than object identity. A user
 * dismissal suppresses only that inbox item until it is consumed or replaced.
 */
export function transitionIncomingSharePresentation(
  state: IncomingSharePresentationState,
  input: {
    readonly isShareSheetPresented: boolean;
    readonly pendingShareId: string | null;
  },
): IncomingSharePresentationTransition {
  if (input.isShareSheetPresented) {
    if (state.presentedShareId !== null && input.pendingShareId !== state.presentedShareId) {
      // Consumption may happen while the sheet remains mounted. Forget the
      // old presentation immediately so a later handoff may reuse its id.
      return {
        state: EMPTY_INCOMING_SHARE_PRESENTATION_STATE,
        shareIdToPresent: null,
        shareIdDismissed: null,
      };
    }
    return { state, shareIdToPresent: null, shareIdDismissed: null };
  }

  let nextState = state;
  if (state.presentedShareId !== null) {
    if (input.pendingShareId === state.presentedShareId) {
      return {
        state: {
          presentedShareId: null,
          dismissedShareId: state.presentedShareId,
        },
        shareIdToPresent: null,
        shareIdDismissed: state.presentedShareId,
      };
    }
    nextState = { ...state, presentedShareId: null };
  }

  if (input.pendingShareId === null) {
    return {
      state: EMPTY_INCOMING_SHARE_PRESENTATION_STATE,
      shareIdToPresent: null,
      shareIdDismissed: null,
    };
  }

  if (nextState.dismissedShareId === input.pendingShareId) {
    return { state: nextState, shareIdToPresent: null, shareIdDismissed: null };
  }

  return {
    state: {
      presentedShareId: input.pendingShareId,
      dismissedShareId: null,
    },
    shareIdToPresent: input.pendingShareId,
    shareIdDismissed: null,
  };
}
