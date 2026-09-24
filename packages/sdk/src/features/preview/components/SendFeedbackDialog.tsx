import { Alert, AlertDescription } from "@camox/ui/alert";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@camox/ui/dialog";
import { Label } from "@camox/ui/label";
import { Textarea } from "@camox/ui/textarea";
import { toast } from "@camox/ui/toaster";
import { Copy, Info } from "lucide-react";
import * as React from "react";

export function feedbackPrompt(pageId: number, context: string) {
  const request = `Address unresolved Camox feedback for page ID ${pageId}. Load the camox skill and follow its feedback workflow: read the page's comments with the CLI, make the requested changes, and resolve each addressed comment.`;
  const additionalContext = context.trim();
  return additionalContext ? `${request}\n\nAdditional context:\n${additionalContext}` : request;
}

export function SendFeedbackDialog({ pageId, disabled }: { pageId: number; disabled: boolean }) {
  const contextId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [context, setContext] = React.useState("");
  const [copying, setCopying] = React.useState(false);

  const copyPrompt = async () => {
    if (copying) return;

    setCopying(true);
    try {
      await navigator.clipboard.writeText(feedbackPrompt(pageId, context));
      toast.success("Prompt copied. Paste it into your coding agent.");
      setOpen(false);
    } catch {
      toast.error("Could not copy the prompt. Please try again.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger disabled={disabled} render={<Button type="button" className="w-full" />}>
        Send feedback to agent...
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" aria-describedby={`${contextId}-description`}>
        <DialogHeader>
          <DialogTitle>Send feedback to agent</DialogTitle>
        </DialogHeader>
        <Alert>
          <Info />
          <AlertDescription id={`${contextId}-description`}>
            Copy the prompt and paste it into your own coding agent outside of Camox Studio to
            address your feedback. It will resolve the comments on its own.
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Label htmlFor={contextId}>
            Additional context <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id={contextId}
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Add an overall note or extra instructions for your agent…"
            rows={2}
            className="min-h-16"
          />
        </div>
        <DialogFooter>
          <Button type="button" onClick={copyPrompt} disabled={copying}>
            <Copy />
            {copying ? "Copying…" : "Copy agent prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
