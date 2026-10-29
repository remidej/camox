import { Badge } from "@camox/ui/badge";
import { Button } from "@camox/ui/button";
import { Spinner } from "@camox/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { BadgeCheck, Bot } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_auth/_authorize/connect-agent/consent")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  head: () => ({
    meta: [{ title: "Connect to Camox" }],
  }),
  component: ConsentPage,
});

/** The authorization request, signed, exactly as the authorization server sent it here. */
const oauthQuery = () => window.location.search.slice(1);

/**
 * The consent screen of a Connected Agent (ADR 0030): it names the client, says whether that name
 * is verified, and lists the scopes, which the member grants together.
 */
function ConsentPage() {
  const [status, setStatus] = useState<"idle" | "answering" | "error">("idle");
  const { data: screen, isError } = useQuery({
    queryKey: ["connectedAgents", "consent"],
    queryFn: () => api.connectedAgents.consent({ oauthQuery: oauthQuery() }),
    retry: false,
  });

  async function answer(accept: boolean) {
    setStatus("answering");
    try {
      const { data } = await authClient.$fetch<{ url: string }>("/oauth2/consent", {
        method: "POST",
        body: { accept, oauth_query: oauthQuery() },
      });
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  if (isError) {
    return (
      <Heading title="Unable to connect">
        This connection request isn't valid anymore. Start connecting again from your AI.
      </Heading>
    );
  }
  if (!screen) return <Spinner />;

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div className="bg-muted flex size-16 items-center justify-center rounded-full">
        <Bot className="text-muted-foreground size-8" />
      </div>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connect {screen.client.name}</h1>
        {screen.client.verified ? (
          <Badge variant="secondary">
            <BadgeCheck data-icon="inline-start" />
            Verified name
          </Badge>
        ) : (
          <Badge variant="outline">Unverified name</Badge>
        )}
      </div>
      <div className="flex w-full flex-col gap-3 text-left">
        <p className="text-muted-foreground text-sm">
          {screen.client.name} will act as you on your Camox websites, with your permissions. It
          will be able to:
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {screen.scopes.map(({ scope, description }) => (
            <li key={scope} className="bg-muted rounded-md px-3 py-2">
              {description}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          It can't publish: you review and publish its drafts in the studio.
        </p>
      </div>
      {status === "error" && (
        <p className="text-destructive text-sm">Something went wrong. Please try again.</p>
      )}
      <div className="flex w-full flex-col gap-2">
        <Button className="w-full" disabled={status === "answering"} onClick={() => answer(true)}>
          Allow
        </Button>
        <Button
          className="w-full"
          variant="ghost"
          disabled={status === "answering"}
          onClick={() => answer(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
