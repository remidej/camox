import type { ServerEvent, ServerEventBus } from "@modelcontextprotocol/server";

import { type ConnectedMember, loadConnectedMember } from "./member";
import type { VerifiedCall } from "./routes";

/** How often an open subscription checks whether its member's projects changed. */
export const PROJECTS_POLL_MS = 30_000;

/**
 * What the member's tools are shaped by: which projects they reach, and how tools name them.
 * Their tools change exactly when this does.
 */
const projectsShape = ({ projects }: ConnectedMember) =>
  JSON.stringify(
    projects.map((project) => [project.id, project.slug, project.name, project.customDomain]),
  );

/**
 * The changes a modern Connected Agent's `subscriptions/listen` stream hears of: its member's
 * tools changing, as their projects do (access gained or lost, a slug changed). Isolates don't
 * share memory and membership changes in many places, so while someone listens the bus checks the
 * member's projects again every so often, rather than waiting to be told.
 */
export function memberChanges(call: VerifiedCall): ServerEventBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  const interval = Number(call.env.CONNECTED_AGENT_PROJECTS_POLL_MS ?? PROJECTS_POLL_MS);
  let shape = projectsShape(call.member);
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;

  const publish = (event: ServerEvent) => {
    for (const listener of listeners) listener(event);
  };
  const check = async () => {
    const member = await loadConnectedMember(call.db, call.member.user.id);
    const now = member ? projectsShape(member) : "";
    if (now === shape) return;
    shape = now;
    publish({ kind: "tools_list_changed" });
  };

  return {
    publish,
    subscribe(listener) {
      listeners.add(listener);
      timer ??= setInterval(() => {
        if (checking) return;
        checking = true;
        check()
          .catch(() => undefined)
          .finally(() => {
            checking = false;
          });
      }, interval);
      return () => {
        listeners.delete(listener);
        if (listeners.size || !timer) return;
        clearInterval(timer);
        timer = undefined;
      };
    },
  };
}
