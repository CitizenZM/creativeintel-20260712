/** Browser reports are untrusted. Bound input, keep no source text, URLs, cookies,
 * query strings or user identifiers; emit a small structured server log. */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 16_384) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 204 });
  let text = "", bytes = 0;
  try {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); return new Response(null, { status: 413 }); }
      text += decoder.decode(value, { stream: true });
    }
    const report = JSON.parse(text)?.["csp-report"];
    if (report && typeof report === "object") {
      const raw = report["blocked-uri"];
      let blocked = ["inline", "eval", "self"].includes(raw) ? raw : "unknown";
      try { blocked = new URL(raw).origin; } catch { /* inline / eval */ }
      const directive = String(report["effective-directive"] || "unknown").slice(0, 80);
      console.info("[csp-report]", JSON.stringify({ directive, blocked }));
    }
  } catch { /* Invalid reports are ignored. */ }
  return new Response(null, { status: 204 });
}
