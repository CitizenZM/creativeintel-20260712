import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel builds with pnpm (strict): a package that is only a transitive dependency resolves locally
 * (hoisted node_modules) but fails the production type-check. Every bare import must be a direct one.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "zz-ops" || name === "generated" || name === "__fixtures__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("dependencies", () => {
  it("every bare-module import in src is a direct dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const builtin = new Set(builtinModules);
    const missing = new Set<string>();
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:^\s*(?:import|export)\b[^;'"]*?\bfrom\s+|^\s*import\s+|\bimport\(\s*)["']((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9._/-]*)?)["']/gm)) {
        const spec = m[1];
        if (spec.startsWith("@/") || spec.startsWith("node:")) continue;
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        if (builtin.has(name) || direct.has(name) || direct.has(`@types/${name}`)) continue;
        missing.add(`${name} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
