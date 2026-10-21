import type { TouchedBatch } from "@camox/api-contract/threads";
import * as React from "react";

/** The Studio session's following of the agent, for the thread and the Canvas to feed. */
export interface StudioFollow {
  /** What a script of a run this Studio follows touched. */
  receive(batch: TouchedBatch): void;
  /** The editor sent a message: its run starts following again. */
  resume(): void;
  /** The editor panned, zoomed or selected on the Canvas themselves: following stops for the run. */
  takeOver(): void;
}

export const FollowAgentContext = React.createContext<StudioFollow | null>(null);
