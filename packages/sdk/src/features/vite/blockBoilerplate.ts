import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { ViteDevServer } from "vite";

const MAX_EMPTY_BLOCK_CHARACTER_COUNT = 50;

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function kebabToPascal(str: string): string {
  const camel = kebabToCamel(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function kebabToTitle(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getBlockBoilerplate(filename: string): string {
  const name = filename.replace(/\.tsx?$/, "");
  const camelName = kebabToCamel(name);
  const pascalName = kebabToPascal(name);
  const title = kebabToTitle(name);

  return `import { Type, createBlock } from "camox/createBlock";

const ${camelName} = createBlock({
  id: "${name}",
  title: "${title}",
  description: "Describe when the AI should use this block.",
  content: {
    title: Type.String({ default: "Title" }),
  },
  component: ${pascalName}Component,
});

function ${pascalName}Component() {
  return (
    <section>
      <${camelName}.Field name="title">
        {(content) => <h1>{content}</h1>}
      </${camelName}.Field>
    </section>
  );
}

export { ${camelName} as block };
`;
}

export function watchNewBlockFiles(server: ViteDevServer) {
  // Watch for new block files and auto-prefill with boilerplate
  const blocksDir = resolve(server.config.root, "src/blocks");

  server.watcher.on("add", (filePath) => {
    if (
      filePath.startsWith(blocksDir) &&
      /\.tsx?$/.test(filePath) &&
      !filePath.includes("index.")
    ) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content.trim().length < MAX_EMPTY_BLOCK_CHARACTER_COUNT) {
          const filename = basename(filePath);
          const boilerplate = getBlockBoilerplate(filename);
          writeFileSync(filePath, boilerplate);
          server.config.logger.info(
            `[camox] Auto-filled block boilerplate: ${filename}`,
            { timestamp: true },
          );
        }
      } catch {
        // File might be locked or inaccessible, ignore
        server.config.logger.error(
          `[camox] Could not auto-fill boilerplate at path ${filePath}`,
          { timestamp: true },
        );
      }
    }
  });
}
