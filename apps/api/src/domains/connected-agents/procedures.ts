import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as consent from "./consent";

/** What the Dashboard's consent screen shows a member connecting a Connected Agent. */
const consentScreen = authed
  .input(consent.consentInput)
  .handler(({ context, input }) => runService(consent.consentScreen(context, input)));

export const connectedAgentProcedures = { consent: consentScreen };
