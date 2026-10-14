/** Uses a DIRECT session connection; VACUUM FULL cannot run through a
 * transaction pooler or inside a transaction. Defaults to read-only sizing. */
import pg from "pg";
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Set DIRECT_DATABASE_URL to the application's direct/session connection");
const parsed = new URL(url);
const schema = parsed.searchParams.get("schema") || "public";
parsed.searchParams.delete("schema");
const ssl = parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined;
if (ssl) parsed.searchParams.delete("sslmode");
const db = new pg.Client({ connectionString: parsed.toString(), ssl, connectionTimeoutMillis: 10_000 });
const quote = (x) => '"' + x.replaceAll('"', '""') + '"';
await db.connect();
try {
  console.log((await db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
    pg_size_pretty(pg_total_relation_size($1::regclass)) AS storyboard_total`, [`${quote(schema)}."Storyboard"`])).rows);
  if (process.argv.includes("--vacuum-full")) {
    // Wait at most five seconds for the exclusive table lock, rather than
    // freezing a busy production database behind a maintenance request.
    await db.query("SET lock_timeout = '5s'");
    await db.query("SET statement_timeout = '10min'");
    await db.query(`VACUUM (FULL, ANALYZE) ${quote(schema)}."Storyboard"`);
    console.log("Storyboard VACUUM FULL completed");
  }
} finally { await db.end(); }
