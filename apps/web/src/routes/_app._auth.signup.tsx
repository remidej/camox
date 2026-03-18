import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient, signUp } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_auth/signup")({
  component: SignupPage,
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

function SignupPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signUp.email({ name, email, password });

    if (result.error) {
      setError(result.error.message ?? "Sign up failed");
      setLoading(false);
      return;
    }

    if (redirect && isSafeRedirect(redirect)) {
      // Generate a one-time token so the SDK on the other domain can establish a session
      const { data: tokenData } = await (authClient as any).oneTimeToken.generate();
      const url = new URL(redirect);
      if (tokenData?.token) {
        url.searchParams.set("ott", tokenData.token);
      }
      window.location.href = url.toString();
      return;
    }

    navigate({ to: "/dashboard" });
  };

  const loginHref = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login";

  return (
    <div className="w-full max-w-sm space-y-6 rounded-xl border px-4 py-4">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
        <p className="text-muted-foreground text-sm">Enter your details to get started</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <a href={loginHref} className="text-primary underline-offset-4 hover:underline">
          Sign in
        </a>
      </p>
    </div>
  );
}
