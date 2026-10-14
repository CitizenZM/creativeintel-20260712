import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const pluginRequire = createRequire(createRequire(require.resolve("eslint-config-next")).resolve("@next/eslint-plugin-next"));
const globRequire = createRequire(pluginRequire.resolve("fast-glob"));
const matchRequire = createRequire(globRequire.resolve("micromatch"));
const braces = matchRequire("braces") as { parse(input: string): unknown; expand(input: string): string[] };

describe("braces local security patch", () => {
  it("keeps normal CLI glob expansion working", () => {
    expect(braces.expand("src/{app,lib}/file.ts")).toEqual(["src/app/file.ts", "src/lib/file.ts"]);
  });
  it.each(["{", "("])("rejects hostile deep %s nesting before recursive traversal", (open) => {
    const close = open === "{" ? "}" : ")";
    expect(() => braces.parse(open.repeat(1000) + "x" + close.repeat(1000))).toThrow(/safe limit/);
  });
});
