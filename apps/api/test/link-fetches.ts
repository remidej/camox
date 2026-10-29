import { env } from "cloudflare:workers";

// Stands in for the outside websites the Link checker fetches, in integration tests: the release
// fakes Worker (test/release-fakes.js), which every outbound fetch reaches in tests, answers a
// scripted URL as scripted. Scripted URLs should be unique to their test, as the fakes are shared.

/** How a URL answers: a status to a GET and `head` (or `status`) to a HEAD, or no connection. */
export type LinkAnswer = { status: number; head?: number } | "unreachable";

type LinkFakes = {
  answerLink(url: string, answers: LinkAnswer[]): Promise<void>;
  linkFetches(url: string): Promise<string[]>;
};

const fakes = (env as unknown as { RELEASE_FAKES: LinkFakes }).RELEASE_FAKES;

/** Makes `url` answer each of `answers` in turn, then the last one from then on. */
export const answerLink = (url: string, ...answers: LinkAnswer[]) => fakes.answerLink(url, answers);

/** The methods `url` was fetched with so far, in order. */
export const linkFetches = (url: string) => fakes.linkFetches(url);

/** A URL on an outside website no other test links to. */
export const outsideUrl = (path = "") => `https://${crypto.randomUUID()}.example.com/${path}`;
