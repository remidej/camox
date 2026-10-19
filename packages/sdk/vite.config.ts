import { transform as compileReact } from "oxc-transform-react";
import { defineConfig } from "vite-plus";

import { transformArtifactRuntime } from "./src/features/vite/artifactRuntimeMinification";

export default defineConfig({
  pack: {
    entry: {
      "core/dom": "src/core/dom.ts",
      "core/createApp": "src/core/createApp.ts",
      "core/createCollection": "src/core/createCollection.ts",
      "core/createBlock": "src/core/createBlock.tsx",
      "core/createLayout": "src/core/createLayout.tsx",
      "core/defineDocument": "src/core/defineDocument.ts",
      "features/preview/CamoxPreview": "src/features/preview/CamoxPreview.tsx",
      "features/content/CamoxContent": "src/features/content/CamoxContent.tsx",
      "features/provider/CamoxProvider": "src/features/provider/CamoxProvider.tsx",
      "features/studio/CamoxStudio": "src/features/studio/CamoxStudio.tsx",
      "features/navigation/navigation": "src/features/navigation/navigation.tsx",
      "features/vite/vite": "src/features/vite/vite.ts",
      "features/runtime/runtime": "src/features/runtime/runtime.ts",
      "features/runtime/pageServer": "src/features/runtime/pageServer.tsx",
      "features/runtime/pageClient": "src/features/runtime/pageClient.tsx",
      "features/runtime/studioClient": "src/features/runtime/studioClient.tsx",
      "features/runtime/studioServer": "src/features/runtime/studioServer.tsx",
      "features/runtime/worker": "src/features/runtime/worker.ts",
      // An explicit entry: tsdown can't traverse the dynamic
      // `await import("camox/_internal/imageResponse")` in createLayout.
      "features/og/imageResponse": "src/features/og/imageResponse.ts",
    },
    format: "esm",
    outDir: "dist",
    clean: true,
    unbundle: true,
    dts: true,
    minify: false,
    outExtensions: () => ({ js: ".js" }),
    deps: { neverBundle: true },
    inputOptions: {
      external: [
        "virtual:camox-studio-css",
        "virtual:camox-overlay-css",
        "virtual:camox/server",
        // Self-import in `createLayout.tsx`: the app's bundler, not this pack, must load
        // the renderer's WASM, so it stays the bare specifier.
        "camox/_internal/imageResponse",
        // Inferred API types reach into the unpublished api app through
        // @camox/api-contract. Declaration emit can't follow them there, and
        // no public type keeps them, so leave them unresolved.
        /\/apps\/api\/src\//,
      ],
    },
    plugins: [
      { name: "camox:minify-artifact-runtime", transform: transformArtifactRuntime },
      {
        // Oxc's React Compiler. It strips TypeScript but keeps JSX for the pack to transform.
        name: "camox:react-compiler",
        transform: {
          // Declaration emit routes `.d.ts` modules through here too; they hold no components.
          filter: { id: { include: /\.[jt]sx?$/, exclude: [/node_modules/, /\.d\.[cm]?ts$/] } },
          async handler(code, id) {
            const result = await compileReact(id, code, { jsx: "preserve", sourcemap: true });
            if (result.fatal) {
              const diagnostics = result.errors.map((error) =>
                error.codeframe ? `${error.message}\n${error.codeframe}` : error.message,
              );
              throw new Error(diagnostics.join("\n\n"));
            }
            return { code: result.code, map: result.map };
          },
        },
      },
    ],
  },
});
