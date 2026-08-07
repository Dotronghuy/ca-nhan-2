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
  assert.match(html, /<title>Lặp \| Chuyện chúng mình<\/title>/i);
  assert.match(html, /Gom từng khoảnh khắc/);
  assert.match(html, /Kỷ niệm/);
  assert.match(html, /Thêm khoảnh khắc/);
  assert.match(html, /accept="image\/\*,video\/\*,\.mov,\.m4v"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("large media falls back to the current session and delete confirmation is custom", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(source, /MAX_(?:IMAGE|VIDEO)_SIZE/);
  assert.match(source, /navigator\.storage\?\.persist/);
  assert.match(source, /prepared = \{ \.\.\.prepared, temporary: true \}/);
  assert.match(source, /CHỈ TRONG PHIÊN NÀY/);
  assert.match(source, /Đừng tải lại hoặc đóng trang trước khi quay xong/);
  assert.doesNotMatch(source, /không đọc được hoặc quá dung lượng/);
  assert.match(source, /async function clearMedia/);
  assert.match(source, /Xóa tất cả/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /delete-confirm-backdrop/);
  assert.match(styles, /\.delete-confirm-dialog/);
  assert.doesNotMatch(source, /window\.(?:alert|confirm)\s*\(/);
});

test("up to four visible video previews play until scrolled past", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /MAX_ACTIVE_VIDEO_PREVIEWS = 4/);
  assert.match(source, /VIDEO_PREVIEW_START_RATIO = 0\.35/);
  assert.match(source, /VIDEO_PREVIEW_STOP_RATIO = 0\.08/);
  assert.match(source, /videoPreviewRegistry/);
  assert.match(source, /slice\(0, MAX_ACTIVE_VIDEO_PREVIEWS\)/);
  assert.match(source, /registration\.ratio <= VIDEO_PREVIEW_STOP_RATIO/);
  assert.doesNotMatch(source, /VIDEO_PREVIEW_DURATION_MS|previewTimeout/);
  assert.match(source, /video\.play\(\)/);
  assert.match(source, /video\.pause\(\)/);
  assert.match(source, /muted\s+loop\s+playsInline/);
});

test("romantic background effects stay motion-safe and visually restrained", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /function RomanticEffects/);
  assert.match(source, /ROMANTIC_PARTICLES/);
  assert.match(styles, /\.falling-heart/);
  assert.match(styles, /\.falling-petal/);
  assert.match(source, /pointermove/);
  assert.match(source, /cursor-heart/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /lap-gallery-effects/);
  assert.match(source, /size: 11 \+ \(index % 5\) \* 4/);
  assert.match(source, /burst \? 42 \+ \(index % 3\) \* 18 : 28/);
  assert.match(styles, /\.love-cursor-glow[\s\S]*?display:\s*none/);
  assert.match(styles, /\.cursor-love-trail[\s\S]*?display:\s*none/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("redesign ships responsive breakpoints, dark mode, and real empty-state media", async () => {
  const [source, styles, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /prefers-color-scheme:\s*dark/);
  assert.match(styles, /@media \(max-width:\s*960px\)/);
  assert.match(styles, /@media \(max-width:\s*760px\)/);
  assert.match(styles, /@media \(max-width:\s*480px\)/);
  assert.match(styles, /\.masonry-grid[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(source, /<img src="\/og-v2\.png" alt="" \/>/);
  assert.match(layout, /new URL\("\/og-v2\.png"/);
  assert.doesNotMatch(source, /demo-tile|empty-grid/);
  assert.doesNotMatch(styles, /gradient\(/);
  assert.doesNotMatch(`${source}\n${layout}`, /[—–]/);
});
