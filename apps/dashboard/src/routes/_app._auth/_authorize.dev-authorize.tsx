import { Button } from "@camox/ui/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Laptop } from "lucide-react";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_auth/_authorize/dev-authorize")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  validateSearch: z.object({
    callback: z.string(),
    error: z.enum(["callback_failed"]).optional(),
  }),
  head: () => ({
    meta: [{ title: "Connect a local Camox site" }],
  }),
  component: DevAuthorizePage,
});

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) return true;
  if (normalizedHostname === "[::1]" || normalizedHostname === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}

function getLocalOrigin(callback: string): string | null {
  try {
    const url = new URL(callback);
    if (url.pathname !== "/__camox/auth/callback") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isLoopbackHostname(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function DevAuthorizePage() {
  const { callback, error } = Route.useSearch();
  const origin = getLocalOrigin(callback);
  const [status, setStatus] = useState<"idle" | "authorizing" | "error">(error ? "error" : "idle");

  async function handleAuthorize() {
    if (!origin) return;

    setStatus("authorizing");
    try {
      // The API only hands a token to a callback on this computer.
      const { data } = await authClient.$fetch<{ url: string }>("/cross-domain/local-authorize", {
        method: "POST",
        body: { callback },
      });
      if (!data?.url) {
        setStatus("error");
        return;
      }
      window.location.href = data.url;
    } catch {
      setStatus("error");
    }
  }

  if (!origin) {
    return (
      <AuthorizationMessage
        title="Unable to connect"
        description="This local Camox authorization link is invalid. Return to your development server and try again."
      />
    );
  }

  return (
    <>
      <AuthorizationMessage
        title="Connect your local Camox site"
        description={
          <>
            Authorize your local dev server at{" "}
            <span className="text-foreground font-medium">{origin}</span> to sync your code&apos;s
            definitions into your development draft.
          </>
        }
      />
      {status === "error" ? (
        <p className="text-destructive text-sm">
          Camox couldn&apos;t connect to your local site. Please try again.
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-2">
        <Button onClick={handleAuthorize} disabled={status === "authorizing"} className="w-full">
          {status === "authorizing" ? "Connecting…" : "Connect local site"}
        </Button>
      </div>
    </>
  );
}

function AuthorizationMessage({ title, description }: { title: string; description: ReactNode }) {
  return (
    <>
      <div className="bg-muted flex size-16 items-center justify-center rounded-full">
        <Laptop className="text-muted-foreground size-8" />
      </div>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </>
  );
}
