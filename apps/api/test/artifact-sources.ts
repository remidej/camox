import { artifactSourceHash } from "@camox/api-contract";
import { SELF } from "cloudflare:test";
import { expect } from "vite-plus/test";

/** An artifact source as the store serves it, by project and hash. */
export function storedSource(project: { uuid: string }, hash: string) {
  return SELF.fetch(`https://api.camox.ai/artifact-sources/${project.uuid}/${hash}`);
}

/** Expects the store to serve `source` for `project`, under its hash. */
export async function expectStored(project: { uuid: string }, source: string) {
  const response = await storedSource(project, await artifactSourceHash(source));
  expect(response.status, `stored: ${source}`).toBe(200);
  expect(await response.text()).toBe(source);
}

/** Expects the store not to hold `source` for `project`. */
export async function expectNotStored(project: { uuid: string }, source: string) {
  const response = await storedSource(project, await artifactSourceHash(source));
  expect(response.status, `not stored: ${source}`).toBe(404);
}

/** An artifact source no other test writes, titled `name`. */
export const uniqueSource = (name: string) => `<title>${name}</title><p>${crypto.randomUUID()}</p>`;
