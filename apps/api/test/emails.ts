import { env } from "cloudflare:workers";

// What Camox emailed, in integration tests: the release fakes Worker (test/release-fakes.js)
// stands in for the `EMAIL` binding and records every email sent through it. The record is shared
// by every test in a run, so tests read the emails sent to their own fixtures' addresses.

/** An email as Camox sent it. */
export type SentEmail = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

const fakes = (env as unknown as { RELEASE_FAKES: { emailsSent(): Promise<SentEmail[]> } })
  .RELEASE_FAKES;

/** The emails sent to `address` so far, in order. */
export const emailsTo = async (address: string) =>
  (await fakes.emailsSent()).filter(({ to }) => to === address);
