/* oxlint-disable eslint/no-restricted-imports -- This is the styled adapter around Pierre's raw viewer. */
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
  type ControlledCodeViewProps,
  type UncontrolledCodeViewProps,
} from "@pierre/diffs/react";
/* oxlint-enable eslint/no-restricted-imports */
import type { Ref } from "react";

const DIFF_VIEW_UNSAFE_CSS = `
[data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: color-mix(in srgb, var(--card) 88%, var(--background)) !important;
  --diffs-light-bg: var(--diffs-bg) !important;
  --diffs-dark-bg: var(--diffs-bg) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 87%, var(--success));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 87%, var(--destructive));
  background-color: var(--diffs-bg) !important;
}
[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  min-height: 32px !important;
  padding: 6px 10px !important;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent) !important;
  background: color-mix(in srgb, var(--card) 94%, transparent) !important;
  backdrop-filter: blur(16px);
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
}
[data-title] { font-family: var(--font-sans) !important; }
[data-diffs-header] [data-additions-count], [data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-diff], [data-file] { transition: none !important; }
}
`;

export type StyledDiffCodeViewOptions<LAnnotation> = Omit<
  NonNullable<CodeViewProps<LAnnotation>["options"]>,
  "unsafeCSS" | "itemMetrics" | "layout"
>;

type StyledDiffCodeViewProps<LAnnotation> = (
  | Omit<ControlledCodeViewProps<LAnnotation>, "options">
  | Omit<UncontrolledCodeViewProps<LAnnotation>, "options">
) & {
  readonly options?: StyledDiffCodeViewOptions<LAnnotation>;
  readonly viewerRef?: Ref<CodeViewHandle<LAnnotation>>;
};

export function StyledDiffCodeView<LAnnotation = undefined>({
  options,
  viewerRef,
  className,
  ...props
}: StyledDiffCodeViewProps<LAnnotation>) {
  return (
    <CodeView<LAnnotation>
      {...props}
      {...(viewerRef ? { ref: viewerRef } : {})}
      className={
        className
          ? `diff-render-surface outline-none ${className}`
          : "diff-render-surface outline-none"
      }
      options={{
        ...options,
        unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
        itemMetrics: {
          diffHeaderHeight: 32,
          hunkSeparatorHeight: 24,
          spacing: 0,
          paddingTop: 0,
          paddingBottom: 0,
        },
        layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
      }}
    />
  );
}
