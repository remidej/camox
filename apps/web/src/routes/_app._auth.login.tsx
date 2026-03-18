import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient, signIn } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_auth/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
});

function isSafeRedirect(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Sign in failed");
      setLoading(false);
      return;
    }

    if (redirect && isSafeRedirect(redirect)) {
      // Generate a one-time token so the SDK on the other domain can establish a session
      const ottResult = await (authClient as any).oneTimeToken.generate();
      const url = new URL(redirect);
      if (ottResult?.data?.token) {
        url.searchParams.set("ott", ottResult.data.token);
      }
      window.location.href = url.toString();
      return;
    }

    navigate({ to: "/dashboard" });
  };

  const signupHref = redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : "/signup";

  return (
    <div className="w-full max-w-sm space-y-6 rounded-xl border px-4 py-4">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">Enter your credentials to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Don't have an account?{" "}
        <a href={signupHref} className="text-primary underline-offset-4 hover:underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
