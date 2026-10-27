import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as read from "./read";

// The Patrol of the draft the request names through `x-camox-draft`, or Live's (ADR 0011).

const get = authed
  .input(read.getPatrolInput)
  .handler(({ context, input }) => runService(read.getPatrol(context, input)));

export const patrolProcedures = { get };
