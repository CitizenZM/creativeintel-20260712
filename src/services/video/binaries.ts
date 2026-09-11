import { spawn } from "node:child_process";

export interface BinaryInfo {
  available: boolean;
  path?: string;
  version?: string;
}

async function which(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => resolve(code === 0 ? out.trim() : undefined));
    p.on("error", () => resolve(undefined));
  });
}

async function version(path: string, flag = "--version"): Promise<string | undefined> {
  return new Promise((resolve) => {
    const p = spawn(path, [flag]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", () => resolve(out.split("\n")[0]?.trim()));
    p.on("error", () => resolve(undefined));
  });
}

export async function checkBinaries() {
  const [ytdlpPath, ffmpegPath, pythonPath] = await Promise.all([
    which("yt-dlp"),
    which("ffmpeg"),
    which("python3"),
  ]);
  const [ytdlpVer, ffmpegVer, pythonVer] = await Promise.all([
    ytdlpPath ? version(ytdlpPath) : undefined,
    ffmpegPath ? version(ffmpegPath, "-version") : undefined,
    pythonPath ? version(pythonPath) : undefined,
  ]);
  return {
    ytdlp: { available: !!ytdlpPath, path: ytdlpPath, version: ytdlpVer },
    ffmpeg: { available: !!ffmpegPath, path: ffmpegPath, version: ffmpegVer },
    python: { available: !!pythonPath, path: pythonPath, version: pythonVer },
  };
}

export function runProc(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.onLine) s.split("\n").forEach((line: string) => line && opts.onLine!(line));
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onLine) s.split("\n").forEach((line: string) => line && opts.onLine!(line));
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) return reject(new Error(`Process timed out after ${opts.timeoutMs}ms`));
      resolve({ code: code ?? 0, stdout, stderr });
    });
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
