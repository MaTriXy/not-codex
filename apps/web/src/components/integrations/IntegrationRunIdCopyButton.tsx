import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";

export function IntegrationRunIdCopyButton({ runId }: { readonly runId: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "run id" });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={`Copy run id ${runId}`}
      title="Copy run id"
      onClick={() => copyToClipboard(runId, undefined)}
    >
      {isCopied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
