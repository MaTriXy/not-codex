import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export function WorkspaceBreadcrumb(props: {
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <nav aria-label={props.ariaLabel} className={cn("min-w-0", props.className)}>
      <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3">
        {props.children}
      </ol>
    </nav>
  );
}

export function WorkspaceBreadcrumbItem(props: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly current?: boolean;
}) {
  return (
    <li
      aria-current={props.current ? "page" : undefined}
      className={cn(
        "flex min-w-0 items-center font-medium",
        props.current ? "text-foreground" : "shrink-0 text-muted-foreground",
        props.className,
      )}
    >
      {props.children}
    </li>
  );
}

export function WorkspaceBreadcrumbSeparator() {
  return (
    <li aria-hidden="true" className="flex shrink-0 items-center text-icon-muted">
      /
    </li>
  );
}
