import type { Bindings } from "../types";

// The user Workers in the `production` Workers for Platforms dispatch namespace, which serve the
// projects' websites (apps/dispatch), through the Cloudflare API with Camox's token, `CF_TOKEN`.
// API reference: https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/

/** The dispatch namespace every project's Worker is deployed to (../domains/releases/README.md). */
export const DISPATCH_NAMESPACE = "production";

type CloudflareEnv = Pick<Bindings, "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">;

/** An answer of the Cloudflare API that isn't a success. Workflows retry the step. */
export class CloudflareApiError extends Error {
  override name = "CloudflareApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const ACCOUNTS = "https://api.cloudflare.com/client/v4/accounts";

const scriptsUrl = (env: CloudflareEnv) =>
  `${ACCOUNTS}/${env.CLOUDFLARE_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts`;

const scriptUrl = (env: CloudflareEnv, name: string) =>
  `${scriptsUrl(env)}/${encodeURIComponent(name)}`;

/** Calls the Cloudflare API, and returns its envelope's `result`. */
async function cloudflare<T>(
  url: string,
  init: RequestInit & { token: string },
  what: string,
): Promise<T> {
  const { token, ...request } = init;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...request, headers });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    errors?: { code: number; message: string }[];
    result?: T;
  } | null;
  if (!response.ok || !body?.success) {
    const errors = body?.errors?.map(({ code, message }) => `${code} ${message}`).join("; ");
    throw new CloudflareApiError(
      `${what} answered ${response.status}${errors ? `: ${errors}` : ""}`,
      response.status,
    );
  }
  return body.result as T;
}

/** A module of a user Worker: its name, as imports name it, and its content and type. */
export type WorkerModule = { name: string; content: Uint8Array; type: string };

/** A static asset of a user Worker, at its path from the site's root. */
export type WorkerAsset = { path: string; content: Uint8Array; contentType: string };

/** What a user Worker is uploaded with. */
export type UserWorker = {
  mainModule: string;
  modules: WorkerModule[];
  compatibilityDate: string;
  compatibilityFlags: string[];
  /** Its environment variables, as plain text bindings. */
  vars: Record<string, string>;
  assets: WorkerAsset[];
  /** The `_headers` and `_redirects` rules of its assets, if it has any. */
  assetRules: { _headers?: string; _redirects?: string };
  tags: string[];
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.byteLength; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

/**
 * An asset's hash in the upload manifest: 32 hex characters of the SHA-256 of its base64 content
 * and extension, as Cloudflare's example computes it
 * (https://developers.cloudflare.com/workers/static-assets/direct-upload/).
 */
async function assetHash(path: string, base64: string) {
  const extension = /\.([^./]+)$/.exec(path)?.[1] ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(base64 + extension),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Uploads a user Worker's static assets through an upload session: the manifest, then the buckets
 * of files Cloudflare doesn't have yet, all at once. Returns the completion token its upload is given, with
 * how many buckets and bytes it uploaded, for the publish's timing logs.
 * https://developers.cloudflare.com/workers/static-assets/direct-upload/
 */
async function uploadAssets(env: CloudflareEnv, name: string, assets: WorkerAsset[]) {
  const files = await Promise.all(
    assets.map(async (asset) => {
      const base64 = bytesToBase64(asset.content);
      return { ...asset, base64, hash: await assetHash(asset.path, base64) };
    }),
  );
  const manifest = Object.fromEntries(
    files.map(({ path, hash, content }) => [path, { hash, size: content.byteLength }]),
  );
  const session = await cloudflare<{ jwt: string; buckets?: string[][] }>(
    `${scriptUrl(env, name)}/assets-upload-session`,
    {
      method: "POST",
      token: env.CF_TOKEN,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest }),
    },
    "Starting the assets upload",
  );
  // Every file uploaded already: the session's token completes the upload.
  let completion = session.jwt;
  let uploadedFiles = 0;
  let uploadedBytes = 0;
  const byHash = new Map(files.map((file) => [file.hash, file]));
  const forms = (session.buckets ?? []).map((bucket) => {
    const form = new FormData();
    for (const hash of bucket) {
      const file = byHash.get(hash);
      if (!file) throw new CloudflareApiError(`The assets upload asked for an unknown ${hash}`, 0);
      form.append(hash, new File([file.base64], hash, { type: file.contentType }));
      uploadedFiles++;
      uploadedBytes += file.content.byteLength;
    }
    return form;
  });
  // All buckets at once: the upload that completes the set, whichever it is, answers the
  // completion token.
  await Promise.all(
    forms.map(async (form) => {
      const uploaded = await cloudflare<{ jwt?: string }>(
        `${ACCOUNTS}/${env.CLOUDFLARE_ACCOUNT_ID}/workers/assets/upload?base64=true`,
        { method: "POST", token: session.jwt, body: form },
        "Uploading assets",
      );
      if (uploaded?.jwt) completion = uploaded.jwt;
    }),
  );
  return {
    jwt: completion,
    buckets: session.buckets?.length ?? 0,
    files: uploadedFiles,
    bytes: uploadedBytes,
  };
}

/** What an upload of a user Worker sent, and how long its assets and script took. */
export type UserWorkerUpload = {
  /** Its static assets, and those of them Cloudflare didn't have yet, in how many buckets. */
  assets: number;
  assetsUploaded: number;
  assetBuckets: number;
  assetBytesUploaded: number;
  assetsMs: number;
  modules: number;
  moduleBytes: number;
  scriptMs: number;
};

/**
 * Uploads `worker` as the user Worker `name`, replacing any of that name: it serves at once, to
 * whatever dispatch sends to it. https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/methods/update/
 */
export async function uploadUserWorker(
  env: CloudflareEnv,
  name: string,
  worker: UserWorker,
): Promise<UserWorkerUpload> {
  const startedAt = Date.now();
  const uploaded = worker.assets.length > 0 ? await uploadAssets(env, name, worker.assets) : null;
  const assetsDoneAt = Date.now();
  const assets = uploaded
    ? {
        jwt: uploaded.jwt,
        ...(worker.assetRules._headers || worker.assetRules._redirects
          ? { config: worker.assetRules }
          : {}),
      }
    : undefined;
  const metadata = {
    main_module: worker.mainModule,
    compatibility_date: worker.compatibilityDate,
    compatibility_flags: worker.compatibilityFlags,
    bindings: Object.entries(worker.vars).map(([varName, text]) => ({
      type: "plain_text",
      name: varName,
      text,
    })),
    ...(assets ? { assets } : {}),
    tags: worker.tags,
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json",
  );
  for (const module of worker.modules) {
    form.append(module.name, new File([module.content], module.name, { type: module.type }));
  }
  await cloudflare(
    scriptUrl(env, name),
    { method: "PUT", token: env.CF_TOKEN, body: form },
    `Uploading the user Worker ${name}`,
  );
  return {
    assets: worker.assets.length,
    assetsUploaded: uploaded?.files ?? 0,
    assetBuckets: uploaded?.buckets ?? 0,
    assetBytesUploaded: uploaded?.bytes ?? 0,
    assetsMs: assetsDoneAt - startedAt,
    modules: worker.modules.length,
    moduleBytes: worker.modules.reduce((sum, module) => sum + module.content.byteLength, 0),
    scriptMs: Date.now() - assetsDoneAt,
  };
}

/** Whether the user Worker `name` exists. */
export async function userWorkerExists(env: CloudflareEnv, name: string) {
  try {
    await cloudflare(
      scriptUrl(env, name),
      { method: "GET", token: env.CF_TOKEN },
      `Reading the user Worker ${name}`,
    );
    return true;
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) return false;
    throw error;
  }
}

/** Deletes the user Worker `name`, if there is one. */
export async function deleteUserWorker(env: CloudflareEnv, name: string) {
  try {
    await cloudflare(
      `${scriptUrl(env, name)}?force=true`,
      { method: "DELETE", token: env.CF_TOKEN },
      `Deleting the user Worker ${name}`,
    );
  } catch (error) {
    // Never uploaded, or deleted already.
    if (error instanceof CloudflareApiError && error.status === 404) return;
    throw error;
  }
}

/**
 * Deletes every user Worker tagged `tag`.
 * https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/tags/
 */
export async function deleteUserWorkersTagged(env: CloudflareEnv, tag: string) {
  await cloudflare(
    `${scriptsUrl(env)}?tags=${encodeURIComponent(`${tag}:yes`)}`,
    { method: "DELETE", token: env.CF_TOKEN },
    `Deleting the user Workers tagged ${tag}`,
  );
}
