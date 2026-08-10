import type {
  EnvironmentId,
  PullRequestActivity,
  PullRequestDetail,
  PullRequestRef,
} from "@notcodex/contracts";
import type { CodeViewDiffItem } from "@pierre/diffs";
import {
  ActivityIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  Code2Icon,
  ExternalLinkIcon,
  GitCommitHorizontalIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffRenderKey,
  fnv1a32,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import {
  PullRequestActorAvatar,
  PullRequestActorLabel,
  PullRequestCheckStatusIcon,
  PullRequestDiffStat,
  PullRequestStateGlyph,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

type DetailTab = "summary" | "timeline" | "code";

interface PullRequestDetailPanelProps {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly refreshToken: number;
  readonly onBack?: () => void;
}

function detailScope(reference: PullRequestRef): string {
  return `${reference.projectId}:${reference.repository}#${reference.number}`;
}

export function PullRequestDetailPanel({
  environmentId,
  reference,
  refreshToken,
  onBack,
}: PullRequestDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const activityQuery = useEnvironmentQuery(
    pullRequestEnvironment.activity({ environmentId, input: reference }),
  );

  useEffect(() => {
    if (refreshToken === 0) return;
    detailQuery.refresh();
    activityQuery.refresh();
  }, [activityQuery.refresh, detailQuery.refresh, refreshToken]);

  if (detailQuery.data === null && detailQuery.error !== null) {
    return (
      <PullRequestsUnavailableState
        title="Could not load this pull request"
        error={detailQuery.error}
        onRetry={detailQuery.refresh}
      />
    );
  }

  if (detailQuery.data === null) {
    return <PullRequestDetailGhost />;
  }

  const detail = detailQuery.data;
  const activity = activityQuery.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/55 bg-card/55 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {onBack ? (
            <Button
              aria-label="Back to pull requests"
              className="mt-0.5 lg:hidden"
              size="icon-sm"
              variant="ghost"
              onClick={onBack}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          ) : null}
          <PullRequestStateGlyph
            className="mt-1"
            state={detail.state}
            isDraft={detail.isDraft}
            mergeability={detail.mergeability}
            baseBranch={detail.baseBranch}
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-balance text-base font-semibold leading-snug text-foreground sm:text-lg">
              {detail.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">
                {detail.repository}#{detail.number}
              </span>
              <span aria-hidden>·</span>
              <PullRequestActorLabel actor={detail.author} />
              <span aria-hidden>·</span>
              <span>{formatRelativeTimeLabel(detail.updatedAt)}</span>
            </div>
          </div>
          <Button
            render={
              <a
                href={detail.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open on host"
              />
            }
            size="icon-sm"
            variant="outline"
          >
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        </div>

        <nav className="mt-3 flex items-center gap-1" aria-label="Pull request sections">
          <DetailTabButton active={tab === "summary"} onClick={() => setTab("summary")}>
            <ActivityIcon className="size-3.5" />
            Summary
          </DetailTabButton>
          <DetailTabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>
            <MessageSquareIcon className="size-3.5" />
            Timeline
            {activity ? (
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {activity.commentCount + activity.commits.length}
              </span>
            ) : null}
          </DetailTabButton>
          <DetailTabButton active={tab === "code"} onClick={() => setTab("code")}>
            <Code2Icon className="size-3.5" />
            Code
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
              {detail.changedFiles}
            </span>
          </DetailTabButton>
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "summary" ? <SummaryTab detail={detail} /> : null}
        {tab === "timeline" ? (
          <TimelineTab
            detail={detail}
            activity={activity}
            error={activityQuery.error}
            onRetry={activityQuery.refresh}
          />
        ) : null}
        {tab === "code" ? (
          <CodeTab
            environmentId={environmentId}
            reference={reference}
            refreshToken={refreshToken}
          />
        ) : null}
      </div>
    </div>
  );
}

function DetailTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-foreground/[0.08] text-foreground shadow-xs dark:bg-white/[0.09]"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SummaryTab({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-5 2xl:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="min-w-0 rounded-2xl border border-border/55 bg-card/58 p-4 shadow-sm/5 backdrop-blur-xl sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <code className="rounded-md border border-border/55 bg-background/55 px-2 py-1">
            {detail.headBranch}
          </code>
          <span>into</span>
          <code className="rounded-md border border-border/55 bg-background/55 px-2 py-1">
            {detail.baseBranch}
          </code>
          <PullRequestDiffStat
            className="ml-auto"
            additions={detail.additions}
            deletions={detail.deletions}
          />
        </div>
        {detail.body.trim() ? (
          <PullRequestMarkdown text={detail.body} cwd={detail.workspaceRoot} />
        ) : (
          <p className="text-sm italic text-muted-foreground">No description was provided.</p>
        )}
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-border/55 bg-card/58 p-4 shadow-sm/5 backdrop-blur-xl">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Checks
          </h3>
          <p className="mt-2 text-sm font-medium text-foreground">
            {summarizePullRequestChecks(detail.checks)}
          </p>
          <div className="mt-3 space-y-2">
            {detail.checks.slice(0, 8).map((check) => (
              <div
                key={`${check.name}:${check.url ?? ""}`}
                className="flex items-center gap-2 text-xs"
              >
                <PullRequestCheckStatusIcon status={check.status} />
                {check.url ? (
                  <a
                    href={check.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-foreground/80 hover:underline"
                  >
                    {check.name}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-foreground/80">{check.name}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border/55 bg-card/58 p-4 shadow-sm/5 backdrop-blur-xl">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Reviewers
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {detail.reviewers.length > 0 ? (
              detail.reviewers.map((reviewer) => (
                <span
                  key={reviewer.login}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/55 bg-background/45 px-2 py-1 text-xs"
                >
                  <PullRequestActorAvatar actor={reviewer} />
                  {reviewer.login}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No reviewers assigned</span>
            )}
          </div>
          {detail.labels.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/45 pt-3">
              {detail.labels.map((label) => (
                <span
                  key={label.name}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function TimelineTab({
  detail,
  activity,
  error,
  onRetry,
}: {
  detail: PullRequestDetail;
  activity: PullRequestActivity | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (activity === null && error !== null) {
    return (
      <PullRequestsUnavailableState
        title="Could not load activity"
        error={error}
        onRetry={onRetry}
      />
    );
  }
  if (activity === null) return <PullRequestDetailGhost compact />;

  const events = [
    ...activity.commits.map((commit) => ({
      id: `commit:${commit.oid}`,
      at: commit.committedDate,
      kind: "commit" as const,
      title: commit.messageHeadline,
      body: null,
      actor: commit.authors?.[0] ?? null,
      meta: commit.oid.slice(0, 8),
    })),
    ...activity.comments.map((comment) => ({
      id: `comment:${comment.id}`,
      at: comment.createdAt,
      kind: "comment" as const,
      title: comment.reviewState ? `Review · ${comment.reviewState}` : "Comment",
      body: comment.body,
      actor: comment.author,
      meta: comment.path,
    })),
  ].toSorted((left, right) => left.at.localeCompare(right.at));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <div className="relative space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[1.1rem] before:w-px before:bg-border/65">
        <TimelineEventShell
          actor={detail.author}
          icon={<CheckCircle2Icon className="size-3.5" />}
          title="Opened this pull request"
          at={detail.createdAt}
        />
        {events.map((event) => (
          <TimelineEventShell
            key={event.id}
            actor={event.actor}
            icon={
              event.kind === "commit" ? (
                <GitCommitHorizontalIcon className="size-3.5" />
              ) : (
                <MessageSquareIcon className="size-3.5" />
              )
            }
            title={event.title}
            at={event.at}
            meta={event.meta}
          >
            {event.body ? (
              <PullRequestMarkdown text={event.body} cwd={detail.workspaceRoot} className="mt-3" />
            ) : null}
          </TimelineEventShell>
        ))}
      </div>
      {activity.commentsTruncated ? (
        <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Showing {activity.comments.length} of {activity.commentCount} comments. Open the host for
          the complete conversation.
        </p>
      ) : null}
    </div>
  );
}

function TimelineEventShell({
  actor,
  icon,
  title,
  at,
  meta,
  children,
}: {
  actor: PullRequestDetail["author"];
  icon: React.ReactNode;
  title: string;
  at: string;
  meta?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <article className="relative pl-11">
      <span className="absolute left-0 top-2 z-10 flex size-9 items-center justify-center rounded-full border border-border/70 bg-background shadow-sm">
        {actor ? <PullRequestActorAvatar actor={actor} className="size-6" /> : icon}
      </span>
      <div className="rounded-2xl border border-border/55 bg-card/58 p-4 shadow-sm/5 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {actor ? <span className="font-medium text-foreground">{actor.login}</span> : null}
          <span className="text-muted-foreground">{title}</span>
          {meta ? (
            <code className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px]">{meta}</code>
          ) : null}
          <span className="ml-auto text-muted-foreground">{formatRelativeTimeLabel(at)}</span>
        </div>
        {children}
      </div>
    </article>
  );
}

function CodeTab({
  environmentId,
  reference,
  refreshToken,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  refreshToken: number;
}) {
  const { resolvedTheme } = useTheme();
  const scope = detailScope(reference);
  const [state, setState] = useState<{
    scope: string;
    cursor: string | undefined;
    slices: ReadonlyArray<{
      cursor: string | undefined;
      patch: string;
      truncated: boolean;
      nextCursor: string | null;
    }>;
  }>({ scope, cursor: undefined, slices: [] });
  const cursor = state.scope === scope ? state.cursor : undefined;
  const slices = state.scope === scope ? state.slices : [];
  const diffQuery = useEnvironmentQuery(
    pullRequestEnvironment.diff({
      environmentId,
      input: { ...reference, ...(cursor ? { cursor } : {}) },
    }),
  );

  useEffect(() => {
    setState({ scope, cursor: undefined, slices: [] });
  }, [scope]);

  useEffect(() => {
    const data = diffQuery.data;
    if (data === null) return;
    setState((current) => {
      const base = current.scope === scope ? current : { scope, cursor: undefined, slices: [] };
      if (base.slices.some((slice) => slice.cursor === cursor)) return base;
      return { ...base, slices: [...base.slices, { cursor, ...data }] };
    });
  }, [cursor, diffQuery.data, scope]);

  useEffect(() => {
    if (refreshToken === 0) return;
    setState({ scope, cursor: undefined, slices: [] });
    diffQuery.refresh();
  }, [diffQuery.refresh, refreshToken, scope]);

  const patch = slices.map((slice) => slice.patch).join("\n");
  const renderable = useMemo(
    () =>
      getRenderablePatch(patch, `pull-request:${scope}:${fnv1a32(patch)}`, {
        compactPartialHunkOffsets: true,
      }),
    [patch, scope],
  );
  const items = useMemo<CodeViewDiffItem<undefined>[]>(
    () =>
      renderable?.kind === "files"
        ? renderable.files.map((file) => ({
            id: buildFileDiffRenderKey(file),
            type: "diff",
            fileDiff: file,
            collapsed: false,
            annotations: [],
            version: fnv1a32(buildFileDiffRenderKey(file)),
          }))
        : [],
    [renderable],
  );
  const latest = slices.at(-1);

  if (slices.length === 0 && diffQuery.error !== null) {
    return (
      <PullRequestsUnavailableState
        title="Could not load the diff"
        error={diffQuery.error}
        onRetry={diffQuery.refresh}
      />
    );
  }
  if (slices.length === 0 && diffQuery.data === null) return <PullRequestDetailGhost compact />;

  return (
    <div className="flex h-full min-h-[28rem] flex-col p-3 sm:p-4">
      {slices.some((slice) => slice.truncated) ? (
        <p className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          The host omitted part of this diff, usually a binary file or a very large hunk.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/65 shadow-sm/5 backdrop-blur-xl">
        {renderable?.kind === "files" ? (
          <StyledDiffCodeView
            className="h-full min-h-[24rem] overflow-auto [scrollbar-gutter:stable]"
            items={items}
            options={{
              diffStyle: "unified",
              overflow: "scroll",
              stickyHeaders: true,
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
            }}
          />
        ) : (
          <pre className="h-full min-h-[24rem] overflow-auto p-4 text-xs leading-5 text-foreground/80">
            {patch}
          </pre>
        )}
      </div>
      {latest?.nextCursor ? (
        <div className="flex justify-center pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={diffQuery.isPending && cursor === latest.nextCursor}
            onClick={() =>
              setState((current) => ({ ...current, cursor: latest.nextCursor ?? undefined }))
            }
          >
            {diffQuery.isPending && cursor === latest.nextCursor ? "Loading…" : "Load more files"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PullRequestDetailGhost({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("animate-pulse space-y-3 p-5", compact ? "mx-auto max-w-3xl" : "h-full")}>
      <div className="h-5 w-2/3 rounded bg-muted/65" />
      <div className="h-3 w-1/3 rounded bg-muted/45" />
      <div className="mt-5 h-36 rounded-2xl border border-border/45 bg-card/45" />
      <div className="h-28 rounded-2xl border border-border/45 bg-card/35" />
    </div>
  );
}
