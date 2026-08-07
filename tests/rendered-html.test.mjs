import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the romantic Lặp Gallery with image and video support", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lặp — Chuyện chúng mình<\/title>/i);
  assert.match(html, /Gom từng khoảnh khắc/);
  assert.match(html, /Kỷ niệm/);
  assert.match(html, /Thêm khoảnh khắc/);
  assert.match(html, /accept="image\/\*,video\/\*,\.mov,\.m4v"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("video previews play briefly when scrolled into view", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /VIDEO_PREVIEW_DURATION_MS = 4_000/);
  assert.match(source, /intersectionRatio >= 0\.65/);
  assert.match(source, /let stopActiveVideoPreview/);
  assert.match(source, /stopActiveVideoPreview\?\.\(\)/);
  assert.match(source, /video\.play\(\)/);
  assert.match(source, /video\.pause\(\)/);
});
