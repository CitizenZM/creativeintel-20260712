import { describe, expect, it } from "vitest";
import { poolOptions, splitSchema } from "./db";

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

describe("poolOptions", () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
  it("defaults: 5 connections, fail after 5 s waiting, release idle after 5 s", () => {
    expect(poolOptions(env({}))).toEqual({ max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 5_000 });
  });
  it("reads the env overrides within sane bounds", () => {
    expect(poolOptions(env({ DB_POOL_MAX: "8", DB_POOL_ACQUIRE_TIMEOUT_MS: "3000", DB_POOL_IDLE_TIMEOUT_MS: "10000" }))).toEqual({
      max: 8,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 10_000,
    });
    expect(poolOptions(env({ DB_POOL_MAX: "0", DB_POOL_ACQUIRE_TIMEOUT_MS: "nope" }))).toMatchObject({
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  });
});
