// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { LocalSnapshotConfirmation } from "./LocalSnapshotConfirmation";

it("requires the complete manifest to be exposed before confirmation", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onConfirm = vi.fn();
  const includedPaths = Array.from({ length: 10 }, (_, index) => `src/file-${index + 1}.ts`);
  const excludedPaths = Array.from({ length: 9 }, (_, index) => `.secret-${index + 1}`);

  act(() => {
    root.render(
      <LocalSnapshotConfirmation
        preview={{
          snapshotId: null,
          manifestDigest: "digest",
          fileCount: includedPaths.length,
          byteCount: 100,
          includedPaths,
          excludedPaths,
        }}
        onConfirm={onConfirm}
      />,
    );
  });

  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const confirm = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Confirm snapshot"),
  )!;
  expect(checkbox.disabled).toBe(true);
  expect(confirm.disabled).toBe(true);
  expect(container.textContent).not.toContain("src/file-10.ts");

  const review = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Review all snapshot paths"),
  )!;
  act(() => review.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(container.textContent).toContain("src/file-10.ts");
  expect(container.textContent).toContain(".secret-9");
  expect(checkbox.disabled).toBe(false);

  act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  act(() => confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onConfirm).toHaveBeenCalledOnce();

  act(() => root.unmount());
  container.remove();
});
