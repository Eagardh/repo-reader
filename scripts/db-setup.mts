/**
 * Applies db/schema.sql. Safe to re-run: every statement is idempotent.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/db-setup.mts
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Run `vercel env pull .env.local --yes`, then re-run with dotenv.",
  );
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

// The driver sends one statement per call, so split on `;` at statement end.
// A statement counts as empty only when nothing but comments remains — the
// leading comment block on a `create table` is part of that statement, not a
// reason to skip it.
const statements = schema
  .split(/;\s*$/m)
  .map((statement) => statement.trim())
  .filter((statement) => {
    const code = statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("")
      .trim();
    return code.length > 0;
  });

for (const statement of statements) {
  await sql.query(statement);
  const summary = statement
    .split("\n")
    .find((line) => line.trim() && !line.trim().startsWith("--"));
  console.log(`ok  ${summary?.trim().slice(0, 60)}`);
}

console.log(`\nApplied ${statements.length} statements.`);
