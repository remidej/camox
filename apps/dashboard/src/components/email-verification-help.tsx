import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { useEffect, useId, useState } from "react";

import { authClient } from "@/lib/auth-client";

export const verificationMessages = {
  EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
  SIGN_UP_EMAIL: "Check your inbox for a verification link before signing in.",
};

export function EmailVerificationHelp({
  email: submittedEmail,
  callbackURL,
  open,
  onOpenChange,
}: {
  email?: string;
  callbackURL?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const emailId = useId();
  const [fallbackEmail, setFallbackEmail] = useState("");
  const email = submittedEmail || fallbackEmail;
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown === 0) return;
    const timeout = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [cooldown]);

  async function resend() {
    if (pending || cooldown > 0) return;
    setPending(true);
    setMessage("");
    setError("");

    try {
      // Keep verification on the dashboard before continuing cross-domain auth.
      const destination = callbackURL ?? "/";
      const localPath =
        destination.startsWith("/") && !destination.startsWith("//")
          ? destination
          : `/?redirect=${encodeURIComponent(destination)}`;
      const result = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: new URL(localPath, window.location.origin).toString(),
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many requests. Please wait a minute before trying again."
            : "Could not send the verification email. Please try again.",
        );
        if (result.error.status === 429) setCooldown(60);
        return;
      }
      setMessage(
        "If this address has an unverified account, a verification link has been sent. Check your inbox and spam folder.",
      );
      setCooldown(60);
    } catch {
      setError("Could not send the verification email. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark font-['Inter',sans-serif]">
        <DialogHeader>
          <DialogTitle>Verify your email to sign in</DialogTitle>
          <DialogDescription>
            Check your inbox for a verification link, or request a new one below.
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void resend();
          }}
        >
          {submittedEmail ? (
            <p className="font-medium break-all">{submittedEmail}</p>
          ) : (
            <>
              <Label htmlFor={emailId}>Email address</Label>
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={fallbackEmail}
                onChange={(event) => setFallbackEmail(event.target.value)}
              />
            </>
          )}
          <Button
            type="submit"
            variant="outline"
            disabled={pending || cooldown > 0}
            className="w-full"
          >
            {pending ? "Sending…" : "Resend verification email"}
          </Button>
          {cooldown > 0 && <p className="text-muted-foreground">You can resend in {cooldown}s.</p>}
          <p role="status" aria-live="polite">
            {message}
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
