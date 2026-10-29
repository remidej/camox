import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as agents from "./agents";
import * as consent from "./consent";

/** What the Dashboard's consent screen shows a member connecting a Connected Agent. */
const consentScreen = authed
  .input(consent.consentInput)
  .handler(({ context, input }) => runService(consent.consentScreen(context, input)));

/** The signed-in member's Connected Agents, for the Dashboard's profile page. */
const list = authed
  .input(agents.listInput)
  .handler(({ context, input }) => runService(agents.listConnectedAgents(context, input)));

/** Disconnects one of the signed-in member's Connected Agents. */
const disconnect = authed
  .input(agents.disconnectInput)
  .handler(({ context, input }) => runService(agents.disconnectConnectedAgent(context, input)));

export const connectedAgentProcedures = { consent: consentScreen, list, disconnect };
