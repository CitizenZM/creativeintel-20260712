import { describe, expect, it } from "vitest";
import { PUBLIC_ERROR_MESSAGE, safePublicError, redactPublicErrors } from "./public-error";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("public error fallback", () => {
  it.each([new Error("SQL connection failed postgres://user:secret@host"), "API key sk-secret is invalid", { message: "private filesystem path" }, null])("never reveals arbitrary exception content", (error) => {
    expect(safePublicError(error)).toBe(PUBLIC_ERROR_MESSAGE);
  });
  it("redacts nested persisted errors while keeping successful data and dates", () => {
    const at = new Date();
    const result = redactPublicErrors({ at, jobs: [{ error: "private token", result: "https://example.com/video.mp4" }, { error: null }] });
    expect(result.at).toBe(at);
    expect(result.jobs[0]).toEqual({ error: PUBLIC_ERROR_MESSAGE, result: "https://example.com/video.mp4" });
    expect(result.jobs[1].error).toBeNull();
  });
  it("API output fields do not serialize arbitrary caught Error messages", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name === "route.ts" ? [join(dir, entry.name)] : []);
    const unsafe = walk(join(process.cwd(), "src/app/api")).filter((file) => /error:\s*(?:\w+(?:\.reason)? instanceof Error \? \w+(?:\.reason)?\.message|String\((?:err|error|e)\))/.test(readFileSync(file, "utf8")));
    expect(unsafe).toEqual([]);
  });
});
