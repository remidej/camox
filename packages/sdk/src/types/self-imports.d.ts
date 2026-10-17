/**
 * Self-import declarations.
 *
 * Inside the SDK source, `import("camox/_internal/imageResponse")` deliberately goes
 * through this package's own `exports` map, so the app's bundler loads the renderer's
 * WASM rather than the SDK's pack. Node and TypeScript only support package
 * self-references when a self-link exists in `node_modules`; inside this workspace
 * package none does, so TypeScript needs a hint.
 */
declare module "camox/_internal/imageResponse" {
  export { ImageResponse } from "../features/og/imageResponse";
}
