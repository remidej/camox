import { runService } from "../../lib/run-service";
import { authed, contentWrite } from "../../orpc";
import * as fixes from "./fixes";
import * as read from "./read";

// The Patrol of the draft the request names through `x-camox-draft`, or Live's (ADR 0011), and
// what members do with its findings (ADR 0034): apply a fix in a draft, or dismiss one anywhere.

const get = authed
  .input(read.getPatrolInput)
  .handler(({ context, input }) => runService(read.getPatrol(context, input)));

const applyFix = contentWrite
  .input(fixes.findingInput)
  .handler(({ context, input }) => runService(fixes.applyFix(context, input)));

const dismissFinding = authed
  .input(fixes.findingInput)
  .handler(({ context, input }) => runService(fixes.dismissFinding(context, input)));

export const patrolProcedures = { get, applyFix, dismissFinding };
