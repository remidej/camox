import type { ThreadView } from "@camox/api-contract/threads";
import { toast } from "@camox/ui/toaster";
import * as React from "react";

/**
 * Says the agent is working in a toast while a run goes in the draft's thread, anyone's, so the
 * editor knows wherever they are in the studio, then how it ended. Live's runs are too quick to
 * need one. Leaving the thread takes the toast away.
 */
export function useAgentRunToast(view: ThreadView, draftId: string | null) {
  const id = React.useId();
  const running = draftId !== null && view.running;
  const ran = React.useRef(false);

  const ended = React.useEffectEvent(() => {
    const last = view.messages.at(-1)?.from;
    if (last === "failed") toast.error("Agent couldn't finish", { id });
    // Whoever stopped it already knows, and the thread says who did.
    else if (last === "stopped") toast.dismiss(id);
    else toast.success("Agent is done", { id });
  });

  React.useEffect(() => {
    if (running) {
      ran.current = true;
      toast.loading("Agent is working…", { id });
    } else if (ran.current) {
      ran.current = false;
      ended();
    }
  }, [running, id]);

  React.useEffect(
    () => () => {
      if (ran.current) toast.dismiss(id);
    },
    [id],
  );
}
