import { useState } from "react";
import { Button } from "../ui/button";

export interface LocalSnapshotPreview {
  readonly snapshotId: string | null;
  readonly manifestDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly includedPaths: ReadonlyArray<string>;
  readonly excludedPaths: ReadonlyArray<string>;
}

export function LocalSnapshotConfirmation({
  preview,
  onConfirm,
  disabled = false,
}: {
  readonly preview: LocalSnapshotPreview;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [showFullManifest, setShowFullManifest] = useState(false);
  const hasHiddenPaths = preview.includedPaths.length > 8 || preview.excludedPaths.length > 8;
  return (
    <section
      aria-labelledby="local-snapshot-confirmation-heading"
      className="space-y-3 rounded-xl border p-4"
    >
      <div>
        <h2 id="local-snapshot-confirmation-heading" className="text-sm font-semibold">
          Review local snapshot
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This immutable copy may be sent to the model provider configured in Open Kritt. The live
          workspace is never mounted.
        </p>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Files</dt>
          <dd>{preview.fileCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bytes</dt>
          <dd>{preview.byteCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Manifest</dt>
          <dd className="truncate font-mono">{preview.manifestDigest}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Included: {preview.includedPaths.slice(0, 8).join(", ") || "none"}
        {preview.includedPaths.length > 8 ? " …" : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        Excluded: {preview.excludedPaths.slice(0, 8).join(", ") || "none"}
        {preview.excludedPaths.length > 8 ? " …" : ""}
      </p>
      {hasHiddenPaths ? (
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showFullManifest}
          onClick={() => {
            setShowFullManifest((value) => !value);
            setConfirmed(false);
          }}
        >
          {showFullManifest ? "Hide full manifest" : "Review all snapshot paths"}
        </Button>
      ) : null}
      {showFullManifest ? (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <h3 className="font-medium">All included paths</h3>
            <ul className="mt-1 max-h-64 overflow-auto rounded-md border p-2 font-mono">
              {preview.includedPaths.map((path) => (
                <li key={`included:${path}`} className="break-all">
                  {path}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">All excluded paths</h3>
            <ul className="mt-1 max-h-64 overflow-auto rounded-md border p-2 font-mono">
              {preview.excludedPaths.map((path) => (
                <li key={`excluded:${path}`} className="break-all">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={hasHiddenPaths && !showFullManifest}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          aria-label="Confirm local snapshot is safe to send"
        />
        <span>
          I confirm these source contents are safe to send to the configured model provider. If the
          workspace changes before the snapshot is created, the server rejects it and you review it
          again.
        </span>
      </label>
      <Button size="sm" disabled={!confirmed || disabled} onClick={onConfirm}>
        Confirm snapshot
      </Button>
    </section>
  );
}
