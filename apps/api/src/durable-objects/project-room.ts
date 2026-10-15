import type { ProjectRoomMessage } from "@camox/api-contract/query-keys";
import { Server } from "partyserver";

import type { Bindings } from "../types";

export class ProjectRoom extends Server<Bindings> {
  async broadcastMessage(message: ProjectRoomMessage): Promise<void> {
    this.broadcast(JSON.stringify(message));
  }
}
