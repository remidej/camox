import { streamProgress } from "../../lib/progress-stream";
import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as service from "./service";

/**
 * Streams where the push stands until it landed, then the push: a build can outlast what an
 * HTTP client waits for a response that says nothing.
 */
const push = authed.input(service.pushInput).handler(async function* ({ context, input }) {
  for await (const event of streamProgress<service.PushStep, service.Pushed>((progress) =>
    runService(service.pushToDraft(context, input, progress)),
  )) {
    if (event.type === "progress") yield { type: "progress" as const, step: event.step };
    else yield { type: "pushed" as const, ...event.value };
  }
});

export const codeProcedures = { push };
