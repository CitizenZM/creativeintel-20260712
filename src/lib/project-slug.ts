/** Cosmetic `<slug>-<id>` builder for project URLs. See `src/middleware.ts`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function projectPath(id: string, brandName: string, suffix = ""): string {
  const slug = slugify(brandName);
  const base = slug ? `${slug}-${id}` : id;
  return `/projects/${base}${suffix}`;
}
