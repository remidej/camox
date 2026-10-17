import { toast } from "@camox/ui/toaster";
import { CopyIcon, TerminalIcon } from "lucide-react";
import { useCallback } from "react";

const CLI_COMMAND = "npm create camox@latest";

export function CreateProjectGuide() {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(CLI_COMMAND);
    toast.success("Command copied to clipboard");
  }, []);

  return (
    <div className="text-muted-foreground flex flex-col items-center gap-4 py-10 text-center">
      <TerminalIcon className="h-10 w-10" />
      <h2 className="text-foreground text-lg font-semibold">Create a project via CLI</h2>
      <p className="max-w-sm text-sm">Run the following command in your terminal to get started.</p>
      <div className="bg-muted flex items-center gap-3 rounded-lg border px-4 py-3">
        <code className="font-mono text-sm">{CLI_COMMAND}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer transition-colors"
          aria-label="Copy command"
        >
          <CopyIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
