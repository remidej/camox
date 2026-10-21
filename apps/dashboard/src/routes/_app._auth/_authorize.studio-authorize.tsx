import { Button } from "@camox/ui/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_auth/_authorize/studio-authorize")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  validateSearch: z.object({
    callback: z.string(),
  }),
  head: () => ({
    meta: [{ title: "Signing in to Camox Studio" }],
  }),
  component: StudioAuthorizePage,
});

type Status = "authorizing" | "refused" | "error";

/**
 * Sends the user straight back to the studio with a one-time token. The API only hands one to a
 * host of a project the user is a member of, or to localhost; any other host gets an error page.
 */
function StudioAuthorizePage() {
  const { callback } = Route.useSearch();
  const [status, setStatus] = useState<Status>("authorizing");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await authClient.$fetch<{ url: string }>(
          "/cross-domain/studio-authorize",
          { method: "POST", body: { callback } },
        );
        if (cancelled) return;
        if (data?.url) {
          window.location.replace(data.url);
          return;
        }
        setStatus(error?.status === 403 || error?.status === 400 ? "refused" : "error");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callback, attempt]);

  let origin: string;
  try {
    origin = new URL(callback).origin;
  } catch {
    origin = callback;
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="bg-muted flex size-16 items-center justify-center rounded-full">
        <LayoutDashboard className="text-muted-foreground size-8" />
      </div>
      {status === "authorizing" ? (
        <Heading title="Signing in to Camox Studio">Taking you back to {origin}…</Heading>
      ) : status === "refused" ? (
        <Heading title="Unable to sign in">
          Camox Studio can't sign in on{" "}
          <span className="text-foreground font-medium">{origin}</span>. It only signs in on the
          sites of projects you're a member of.
        </Heading>
      ) : (
        <>
          <Heading title="Unable to sign in">Something went wrong. Please try again.</Heading>
          <Button
            className="w-full"
            onClick={() => {
              setStatus("authorizing");
              setAttempt((current) => current + 1);
            }}
          >
            Try again
          </Button>
        </>
      )}
    </div>
  );
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
