import { Badge } from "@camox/ui/badge";
import { Button } from "@camox/ui/button";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Bot } from "lucide-react";

import { api } from "@/lib/api";
import { connectedAgentQueries } from "@/lib/queries";

const formatDate = (date: Date) =>
  date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The member's Connected Agents (ADR 0030): each AI they connected to Camox, whether its name is
 * verified, when they connected it and when it last called Camox, with a way to disconnect it.
 */
export function ConnectedAgentsCard() {
  const { data: agents } = useQuery(connectedAgentQueries.list());

  return (
    <section className="bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Connected agents</h2>
        <p className="text-muted-foreground text-sm">
          AIs you connected to Camox. They act as you on your websites, with your permissions.
        </p>
      </div>
      {!agents ? (
        <Spinner />
      ) : agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">You haven't connected any AI to Camox.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((agent) => (
            <ConnectedAgentRow key={agent.id} agent={agent} />
          ))}
        </ul>
      )}
    </section>
  );
}

type ConnectedAgent = Awaited<ReturnType<typeof api.connectedAgents.list>>[number];

function ConnectedAgentRow({ agent }: { agent: ConnectedAgent }) {
  const queryClient = useQueryClient();
  const disconnect = useMutation({
    mutationFn: () => api.connectedAgents.disconnect({ id: agent.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(connectedAgentQueries.list());
      toast.success(`${agent.client.name} disconnected`);
    },
    onError: () => toast.error(`Could not disconnect ${agent.client.name}`),
  });

  return (
    <li className="flex items-center gap-3 rounded-md border px-4 py-3">
      <Bot className="text-muted-foreground size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.client.name}</span>
          {agent.client.verified ? (
            <Badge variant="secondary">
              <BadgeCheck data-icon="inline-start" />
              Verified
            </Badge>
          ) : (
            <Badge variant="outline">Unverified</Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Connected {formatDate(agent.connectedAt)} ·{" "}
          {agent.lastUsedAt ? `Last used ${formatDate(agent.lastUsedAt)}` : "Never used"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disconnect.isPending}
        onClick={() => disconnect.mutate()}
      >
        {disconnect.isPending && <Spinner />}
        Disconnect
      </Button>
    </li>
  );
}
