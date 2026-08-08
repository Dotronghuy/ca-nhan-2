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
  assert.match(html, /accept="image\/\*,video\/\*,\.heic,\.heif,image\/heic,image\/heif,\.mov,\.m4v"/i);
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

test("HEIC and HEIF images are accepted and converted before preview", async () => {
  const [source, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /"heic2any":/);
  assert.match(source, /\\\.\(avif\|gif\|hei\[cf\]\|jpe\?g\|png\|webp\)/);
  assert.match(source, /function isHeicFile/);
  assert.match(source, /import\("heic2any"\)/);
  assert.match(source, /toType:\s*"image\/jpeg"/);
  assert.match(source, /createImageBitmap\(imageBlob\)/);
  assert.match(source, /accept="image\/\*,video\/\*,\.heic,\.heif,image\/heic,image\/heif,\.mov,\.m4v"/);
});

test("uploads show per-file progress and process image/video queues in parallel", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /UPLOAD_IMAGE_CONCURRENCY = 6/);
  assert.match(source, /UPLOAD_VIDEO_CONCURRENCY = 2/);
  assert.match(source, /async function runLimitedQueue/);
  assert.match(source, /fileName:\s*file\.name/);
  assert.match(source, /fileSizeLabel:\s*formatFileSize\(file\.size\)/);
  assert.match(source, /runLimitedQueue\(imageJobs,\s*UPLOAD_IMAGE_CONCURRENCY,\s*processUploadJob\)/);
  assert.match(source, /runLimitedQueue\(videoJobs,\s*UPLOAD_VIDEO_CONCURRENCY,\s*processUploadJob\)/);
  assert.match(source, /type UploadBatch/);
  assert.match(source, /finishUploadTask\(task\.id\)/);
  assert.match(source, /setUploadTasks\(\(tasks\) => tasks\.filter\(\(task\) => task\.id !== id\)\)/);
  assert.match(source, /uploadActiveCount/);
  assert.match(source, /uploadQueuedCount/);
  assert.match(source, /xong mục nào ẩn mục đó/);
  assert.match(source, /title=\{task\.fileName\}/);
  assert.match(source, /\{task\.title\} • \{task\.fileSizeLabel\}/);
  assert.match(styles, /\.upload-task-list[\s\S]*?max-height:\s*360px/);
  assert.match(styles, /\.upload-task\.is-reading/);
});

test("gallery has right-click actions, shuffle, stable masonry columns, and a longer loop", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /const \[contextMenu, setContextMenu\]/);
  assert.match(source, /const shuffleMedia = \(\) =>/);
  assert.match(source, /<Shuffle weight="bold"/);
  assert.match(source, /className="shuffle-button"/);
  assert.match(source, /const openMediaMenu = \(/);
  assert.match(source, /onContextMenu=\{\(event\) => openMediaMenu\(event, media\)\}/);
  assert.match(source, /filteredMedia\.length \+ tileCount/);
  assert.match(source, /repeatedFrameCount/);
  assert.match(source, /function cardAspectRatioFor/);
  assert.doesNotMatch(source, /gridRow:/);
  assert.doesNotMatch(source, /gridColumn:/);
  assert.match(styles, /\.masonry-grid[\s\S]*?column-count:\s*6/);
  assert.match(styles, /@media \(max-width:\s*1180px\)[\s\S]*?\.masonry-grid[\s\S]*?column-count:\s*4/);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.masonry-grid[\s\S]*?column-count:\s*2/);
  assert.match(styles, /\.media-context-menu/);
  assert.match(styles, /\.media-context-menu button\.danger/);
});

test("gallery keeps raw file names out of visible media chrome", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /numberedMediaTitle/);
  assert.match(source, /mediaKindTitle/);
  assert.match(source, /sourceTitle/);
  assert.match(source, /<VideoCamera weight="duotone"/);
  assert.match(source, /<ImageSquare weight="duotone"/);
  assert.match(source, /className="favorite-ribbon"/);
  assert.doesNotMatch(source, /<strong title=\{media\.name\}>\{media\.name\}<\/strong>/);
  assert.doesNotMatch(source, /<strong>\{media\.name\}<\/strong>/);
  assert.doesNotMatch(source, /<h2>\{preview\.name\}<\/h2>/);
  assert.doesNotMatch(source, /alt=\{media\.name\}/);
  assert.doesNotMatch(source, /alt=\{preview\.name\}/);
  assert.doesNotMatch(source, /aria-label=\{preview\.name\}/);
  assert.doesNotMatch(source, /updated\.name/);
  assert.doesNotMatch(source, /deleteIntent\.media\.name/);
  assert.doesNotMatch(source, /className="card-label"/);
  assert.doesNotMatch(source, /className="card-shade"/);
  assert.match(styles, /\.favorite-ribbon/);
  assert.doesNotMatch(styles, /\.card-shade/);
  assert.doesNotMatch(styles, /rgba\(25,\s*12,\s*17,\s*0\.58\)/);
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
  assert.match(styles, /\.masonry-grid[\s\S]*?column-count:\s*2/);
  assert.match(source, /<img src="\/og-v2\.png" alt="" \/>/);
  assert.match(layout, /new URL\("\/og-v2\.png"/);
  assert.doesNotMatch(source, /demo-tile|empty-grid/);
  assert.doesNotMatch(styles, /gradient\(/);
  assert.doesNotMatch(`${source}\n${layout}`, /[—–]/);
});

test("hero tells a complete type, erase, love, and heart-fill story", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /const LOVE_MESSAGE = "ANH YÊU EM"/);
  assert.match(source, /LOVE_HEART_MILESTONES = \[3, 7, LOVE_MESSAGE\.length\]/);
  assert.match(source, /"typing-story"[\s\S]*?"deleting-story"[\s\S]*?"typing-love"/);
  assert.match(source, /"typing-love"[\s\S]*?"holding-love"[\s\S]*?"deleting-love"/);
  assert.doesNotMatch(source, /"filling-hearts"/);
  assert.match(source, /index < filledHearts/);
  assert.match(source, /<Heart className="love-heart-outline" weight="regular"/);
  assert.match(source, /<Heart className="love-heart-fill" weight="fill"/);
  assert.match(styles, /\.love-heart\.is-filled \.love-heart-fill/);
  assert.match(styles, /--heart-red:\s*#e3273e/);
  assert.match(styles, /\.reduced-motion-headline[\s\S]*?display:\s*grid/);
  assert.match(styles, /@keyframes heart-arrive/);
});
