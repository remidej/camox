import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function writeIfChanged(filePath: string, content: string) {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === content) return;
  }
  writeFileSync(filePath, content, "utf-8");
}
