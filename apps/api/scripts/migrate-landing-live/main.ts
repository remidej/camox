/**
 * Migrates a project's Live from a `wrangler d1 export` of the old database into SQL for the new
 * one (ADR 0013). One-off: deleted at cutover (#250), with today's remap code.
 *
 *   pnpm exec tsx scripts/migrate-landing-live/main.ts <export.sql> <out.sql> [project-slug]
 *
 * Writes `<out.sql>` and `<out.sql>.report.json` (counts, dangling ids, orphaned projects). It
 * prints only counts and ids, never row contents: the export holds auth data. Import the SQL
 * into a database built from the baseline:
 *
 *   pnpm exec wrangler d1 execute DB --local --file <out.sql>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { migrateLive, type OldExport, type Row } from "./migrate";

const [exportPath, outPath, projectSlug = "camox-landing"] = process.argv.slice(2);
if (!exportPath || !outPath) {
  console.error("Usage: main.ts <export.sql> <out.sql> [project-slug]");
  process.exit(1);
}

const OLD_TABLES = [
  "user",
  "account",
  "session",
  "verification",
  "organization",
  "member",
  "invitation",
  "projects",
  "environments",
  "layouts",
  "layout_checkpoints",
  "pages",
  "page_checkpoints",
  "blocks",
  "repeatable_items",
  "block_definitions",
  "collection_definitions",
  "collection_records",
  "files",
  "comments",
] as const satisfies readonly (keyof OldExport)[];

function readExport(path: string): OldExport {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  db.exec(readFileSync(path, "utf8"));
  const exported = Object.fromEntries(
    OLD_TABLES.map((table) => [
      table,
      db.prepare(`select * from "${table}" order by rowid`).all() as Row[],
    ]),
  ) as OldExport;
  db.close();
  return exported;
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function toSql(tables: Record<string, Row[]>): string {
  const lines = ["PRAGMA defer_foreign_keys = true;"];
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      const columns = Object.keys(row);
      lines.push(
        `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const exported = readExport(exportPath);
const migration = await migrateLive(exported, { projectSlug, now: Date.now() });
writeFileSync(outPath, toSql(migration.tables));

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((counts, item) => {
    counts[key(item)] = (counts[key(item)] ?? 0) + 1;
    return counts;
  }, {});
const production = exported.environments.find(
  (row) =>
    row.type === "production" &&
    row.project_id === exported.projects.find((project) => project.slug === projectSlug)?.id,
);
const report = {
  rows: Object.fromEntries(
    Object.entries(migration.tables).map(([table, rows]) => [table, rows.length]),
  ),
  export: Object.fromEntries(OLD_TABLES.map((table) => [table, exported[table].length])),
  comments: {
    inProduction: exported.comments.filter((row) => row.environment_id === production?.id).length,
    kept: migration.tables.comments?.length ?? 0,
  },
  orphanedProjects: migration.orphanedProjects,
  dangling: {
    byKind: countBy(migration.dangling, (entry) => entry.kind),
    entries: migration.dangling,
  },
};
writeFileSync(`${outPath}.report.json`, `${JSON.stringify(report, null, 2)}\n`);

console.log("Invariant checks passed.");
console.log("Rows written:", report.rows);
console.log("Comments kept:", report.comments);
console.log("Projects left out (organization gone):", report.orphanedProjects);
console.log("Dangling ids, stored empty:", report.dangling.byKind);
for (const entry of migration.dangling) {
  console.log(`  ${entry.kind} ${entry.id} in ${entry.in.entity} ${entry.in.id}`);
}
