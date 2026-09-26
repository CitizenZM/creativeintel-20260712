import { describe, expect, it } from "vitest";
import { splitSchema } from "./db";

describe("splitSchema", () => {
  it("moves schema and sslmode=require out of the URL", () => {
    const r = splitSchema("postgresql://u:p@h:6543/postgres?sslmode=require&schema=creativeintel");
    expect(r.schema).toBe("creativeintel");
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.connectionString).toBe("postgresql://u:p@h:6543/postgres");
  });
  it("leaves plain URLs alone", () => {
    const r = splitSchema("postgresql://u:p@h/db");
    expect(r).toEqual({ connectionString: "postgresql://u:p@h/db", schema: undefined, ssl: undefined });
  });
});
