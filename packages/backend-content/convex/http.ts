import { registerRoutes } from "convex-fs";
import { httpRouter } from "convex/server";

import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { fs, useLocalStorage } from "./fs";

const http = httpRouter();

if (useLocalStorage) {
  http.route({
    path: "/fs/upload",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return new Response("Unauthorized", { status: 401 });
      }

      const uploadUrl = await ctx.storage.generateUploadUrl();
      const blob = await request.blob();
      const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: blob,
      });

      if (!uploadResponse.ok) {
        return new Response("Upload failed", { status: 500 });
      }

      const { storageId } = (await uploadResponse.json()) as {
        storageId: string;
      };

      return new Response(JSON.stringify({ blobId: storageId }), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  });

  http.route({
    pathPrefix: "/fs/blobs/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const storageId = url.pathname.replace(/^\/fs\/blobs\//, "");
      if (!storageId) {
        return new Response("Missing blobId", { status: 400 });
      }

      const fileUrl = await ctx.storage.getUrl(storageId);
      if (!fileUrl) {
        return new Response("Not found", { status: 404 });
      }

      return Response.redirect(fileUrl, 302);
    }),
  });
} else {
  registerRoutes(http, components.fs, fs!, {
    pathPrefix: "/fs",
    uploadAuth: async (ctx) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity !== null;
    },
    downloadAuth: async () => {
      return true;
    },
  });
}

export default http;
