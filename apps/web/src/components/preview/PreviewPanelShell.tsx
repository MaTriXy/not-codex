import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "notcodex:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the viewport allowed, preserving the remaining space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function getPreviewPanelMaxWidth(viewportWidth: number): number {
  return Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  widthStorageKey?: string;
  defaultWidth?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const maxWidth = useContainerClampedMaxWidth(panelRef);
  const { width, handlers } = useResizableWidth({
    storageKey: props.widthStorageKey ?? PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: props.defaultWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 max-w-full flex-col self-stretch bg-background",
        isInline
          ? props.maximized
            ? "flex-1 border-l border-border"
            : "shrink-0 border-l border-border"
          : "w-full",
      )}
      style={isInline && !props.maximized ? { width: `${width}px` } : undefined}
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && !props.maximized ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {props.children}
    </div>
  );
}

/**
 * Track the width of the flex container shared by chat and the preview panel.
 * This accounts for the resizable app sidebar as well as OS-window changes,
 * so the panel cannot consume space that is unavailable to ChatView.
 */
function useContainerClampedMaxWidth(panelRef: RefObject<HTMLDivElement | null>): number {
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;

    const updateWidth = (width: number) => {
      if (width <= 0) return;
      setContainerWidth((currentWidth) => (currentWidth === width ? currentWidth : width));
    };

    const measure = () => updateWidth(container.getBoundingClientRect().width);
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries.find(({ target }) => target === container);
      updateWidth(entry?.contentRect.width ?? container.getBoundingClientRect().width);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [panelRef]);

  return getPreviewPanelMaxWidth(containerWidth);
}
