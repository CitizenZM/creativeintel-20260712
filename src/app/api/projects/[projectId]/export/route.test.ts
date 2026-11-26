import { beforeEach, describe, expect, it, vi } from "vitest";

type AsRow = { id: string; projectId: string; status: string; finalMp4Url: string | null; hookType: string; engine: string; plan: unknown; input: unknown; updatedAt: Date };

const h = vi.hoisted(() => ({ adStudio: [] as AsRow[] }));
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "p1" ? { id: "p1", name: "Spring", brandName: "Moneta", brand: null, campaignGoal: null } : null) },
    script: { findMany: async () => [] },
    storyboard: { findMany: async () => [] },
    libtvRun: { findMany: async () => [] },
    adStudioRun: {
      // honours the same filters the deliver page uses: project, completed, has a final MP4
      findMany: async ({ where }: { where: { projectId: string; status: string; finalMp4Url: { not: null } } }) =>
        h.adStudio.filter((r) => r.projectId === where.projectId && r.status === where.status && r.finalMp4Url != null),
    },
  },
}));

import { GET } from "./route";

const unzipText = async (res: Response) => new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
const get = (id = "p1") => GET(new Request(`https://x/api/projects/${id}/export`), { params: Promise.resolve({ projectId: id }) });

const run = (o: Partial<AsRow>): AsRow => ({
  id: "cmasrun00000000000abc123",
  projectId: "p1",
  status: "completed",
  finalMp4Url: "https://cdn.example.com/as/final-p1.mp4",
  hookType: "question",
  engine: "kling",
  plan: { durationS: 15 },
  input: { storyboard: { title: "Morning routine" } },
  updatedAt: new Date("2026-11-20T00:00:00Z"),
  ...o,
});

beforeEach(() => {
  h.adStudio = [];
});

describe("GET /api/projects/[projectId]/export — Ad Studio videos", () => {
  it("lists each finished Ad Studio video's MP4 link and ad name in campaign.html and the manifest", async () => {
    h.adStudio = [run({})];
    const res = await get();
    expect(res.status).toBe(200);
    const zip = await unzipText(res);
    expect(zip).toContain("Ad Studio videos (1)");
    expect(zip).toContain('href="https://cdn.example.com/as/final-p1.mp4"');
    expect(zip).toContain("Moneta_MorningRoutine_15s_ASQuestion_EKling_Rabc123");
    expect(zip).toContain("adstudio-runs.json");
    expect(zip).toMatch(/"finalMp4Url": "https:\/\/cdn\.example\.com\/as\/final-p1\.mp4"/);
  });

  it("never includes another project's run, an unfinished run or one without an MP4", async () => {
    h.adStudio = [
      run({ id: "other0000000000000zzz999", projectId: "p2", finalMp4Url: "https://cdn.example.com/as/OTHER-PROJECT.mp4" }),
      run({ id: "runn00000000000000rrr111", status: "running", finalMp4Url: "https://cdn.example.com/as/RUNNING.mp4" }),
      run({ id: "nomp00000000000000nnn222", finalMp4Url: null }),
    ];
    const zip = await unzipText(await get());
    expect(zip).not.toContain("OTHER-PROJECT");
    expect(zip).not.toContain("RUNNING.mp4");
    expect(zip).not.toContain("zzz999");
    expect(zip).toContain("Ad Studio videos (0)");
  });

  it("still 404s for an unknown project", async () => {
    expect((await get("nope")).status).toBe(404);
  });
});
