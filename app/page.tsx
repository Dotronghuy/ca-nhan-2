"use client";

import { Heart, ImageSquare, Shuffle, Star, Trash, VideoCamera } from "@phosphor-icons/react";
import {
  type CSSProperties,
  type MouseEvent,
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  supabase,
  fetchSupabaseMedia,
  insertSupabaseMedia,
  updateSupabaseMediaSpecial,
  deleteSupabaseMedia,
  clearSupabaseMedia,
  uploadToSupabaseStorage,
  getSupabaseSetting,
  setSupabaseSetting,
} from "@/lib/supabase";

type MediaKind = "image" | "video";

type GalleryMedia = {
  id: string;
  name: string;
  kind: MediaKind;
  dataUrl?: string;
  blob?: Blob;
  mimeType: string;
  src: string;
  width: number;
  height: number;
  duration?: number;
  special: boolean;
  createdAt: number;
  temporary?: boolean;
};

type StoredGalleryMedia = Omit<GalleryMedia, "kind" | "mimeType" | "src"> & {
  kind?: MediaKind;
  mimeType?: string;
};

type DeleteIntent =
  | { kind: "single"; media: GalleryMedia }
  | { kind: "all" };

type UploadTaskStatus =
  | "queued"
  | "reading"
  | "converting"
  | "optimizing"
  | "saving"
  | "complete"
  | "temporary"
  | "error";

type UploadTask = {
  id: string;
  title: string;
  fileName: string;
  fileSizeLabel: string;
  kind: MediaKind;
  progress: number;
  status: UploadTaskStatus;
  detail: string;
};

type UploadBatch = {
  total: number;
  processed: number;
  errors: number;
};

type MediaContextMenu = {
  media: GalleryMedia;
  x: number;
  y: number;
};

const DB_NAME = "lap-gallery";
const STORE_NAME = "images";
const COUNT_OPTIONS = [24, 42, 72, 108];
const MAX_ACTIVE_VIDEO_PREVIEWS = 4;
const VIDEO_PREVIEW_START_RATIO = 0.35;
const VIDEO_PREVIEW_STOP_RATIO = 0.08;
const STORY_LEAD = "Gom từng khoảnh khắc,";
const STORY_ACCENT = "giữ cả chuyện chúng mình.";
const LOVE_MESSAGE = "ANH YÊU EM";
const LOVE_HEART_MILESTONES = [3, 7, LOVE_MESSAGE.length];
const UPLOAD_IMAGE_CONCURRENCY = 6;
const UPLOAD_VIDEO_CONCURRENCY = 2;
const UPLOAD_DONE_STATUSES = new Set<UploadTaskStatus>(["complete", "temporary", "error"]);
const UPLOAD_ACTIVE_STATUSES = new Set<UploadTaskStatus>([
  "reading",
  "converting",
  "optimizing",
  "saving",
]);

type HeadlinePhase =
  | "typing-story"
  | "holding-story"
  | "deleting-story"
  | "typing-love"
  | "holding-love"
  | "deleting-love";

type RomanticParticleStyle = CSSProperties & {
  "--particle-size": string;
  "--particle-sway": string;
  "--particle-spin": string;
};

const ROMANTIC_PARTICLES = Array.from({ length: 30 }, (_, index) => ({
  kind: index % 7 === 0 ? "sparkle" : index % 2 === 0 ? "heart" : "petal",
  left: (index * 37 + 9) % 100,
  delay: -((index * 1.73) % 19),
  duration: 11 + (index % 8) * 1.15,
  size: 11 + (index % 5) * 4,
  sway: (index % 2 === 0 ? 1 : -1) * (24 + (index % 4) * 14),
  spin: (index % 2 === 0 ? 1 : -1) * (260 + (index % 5) * 75),
}));

type VideoPreviewRegistration = {
  active: boolean;
  eligible: boolean;
  ratio: number;
  start: () => void;
  stop: () => void;
};

const videoPreviewRegistry = new Set<VideoPreviewRegistration>();
let videoPreviewsSuspended = false;

function syncVideoPreviews() {
  const selected = new Set(
    videoPreviewsSuspended
      ? []
      : [...videoPreviewRegistry]
        .filter((preview) => preview.eligible)
        .sort((left, right) => right.ratio - left.ratio)
        .slice(0, MAX_ACTIVE_VIDEO_PREVIEWS),
  );

  videoPreviewRegistry.forEach((preview) => {
    if (selected.has(preview)) preview.start();
    else preview.stop();
  });
}

function setVideoPreviewsSuspended(suspended: boolean) {
  videoPreviewsSuspended = suspended;
  syncVideoPreviews();
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|hei[cf]|jpe?g|png|webp)$/i.test(file.name);
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(m4v|mov|mp4|ogv|webm)$/i.test(file.name);
}

function isHeicFile(file: File) {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function mediaKindForFile(file: File): MediaKind {
  return isVideoFile(file) ? "video" : "image";
}

function uploadTaskTitle(file: File, index: number) {
  const kind = mediaKindForFile(file) === "video" ? "Video" : "Ảnh";
  return `${kind} đang nhập ${String(index + 1).padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function runLimitedQueue<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runnerCount = Math.min(Math.max(1, concurrency), items.length);
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Không thể tối ưu ảnh này."));
      }
    }, type, quality);
  });
}

function blobToDataUrl(blob: Blob, onProgress?: (progress: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Không thể đọc ảnh này."));
    reader.readAsDataURL(blob);
  });
}

function hydrateMedia(item: StoredGalleryMedia): GalleryMedia {
  const kind = item.kind ?? "image";
  const src = kind === "video" && item.blob
    ? URL.createObjectURL(item.blob)
    : item.dataUrl ?? "";

  return {
    ...item,
    kind,
    mimeType: item.mimeType ?? (kind === "video" ? "video/mp4" : "image/webp"),
    src,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readMedia(): Promise<GalleryMedia[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      resolve(
        (request.result as StoredGalleryMedia[])
          .map(hydrateMedia)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
      database.close();
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveMedia(media: GalleryMedia): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const storedMedia: Partial<GalleryMedia> = { ...media };
    delete storedMedia.src;
    transaction.objectStore(STORE_NAME).put(storedMedia);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function removeMedia(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearMedia(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function prepareImage(
  file: File,
  onProgress: (progress: number, detail: string, status?: UploadTaskStatus) => void = () => {},
): Promise<GalleryMedia> {
  let imageBlob: Blob = file;
  if (isHeicFile(file)) {
    onProgress(18, "Đang chuyển HEIC", "converting");
    await waitForPaint();
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.92,
    });
    imageBlob = Array.isArray(converted) ? converted[0] : converted;
  }

  onProgress(36, "Đang đọc ảnh", "reading");
  await waitForPaint();
  const bitmap = await createImageBitmap(imageBlob);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể xử lý ảnh này.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  onProgress(66, "Đang tối ưu ảnh", "optimizing");
  await waitForPaint();
  const optimizedBlob = await canvasToBlob(canvas, "image/webp", 0.88);
  onProgress(78, "Đang chuẩn bị hiển thị", "optimizing");
  const dataUrl = await blobToDataUrl(optimizedBlob, (ratio) => {
    onProgress(78 + Math.round(ratio * 8), "Đang nạp ảnh vào bộ nhớ", "optimizing");
  });

  return {
    id: `${Date.now()}-${crypto.randomUUID()}`,
    name: file.name.replace(/\.[^/.]+$/, "") || "Ảnh mới",
    kind: "image",
    dataUrl,
    mimeType: "image/webp",
    src: dataUrl,
    width,
    height,
    special: false,
    createdAt: Date.now(),
  };
}

async function prepareVideo(
  file: File,
  onProgress: (progress: number, detail: string, status?: UploadTaskStatus) => void = () => {},
): Promise<GalleryMedia> {
  const src = URL.createObjectURL(file);

  try {
    onProgress(28, "Đang đọc video", "reading");
    await waitForPaint();
    const metadata = await new Promise<{
      width: number;
      height: number;
      duration: number;
    }>((resolve, reject) => {
      const video = document.createElement("video");
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
      };

      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        const width = Math.max(1, video.videoWidth);
        const height = Math.max(1, video.videoHeight);
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        cleanup();
        resolve({ width, height, duration });
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("Không thể đọc video này."));
      };
      video.src = src;
    });

    onProgress(72, "Đang chuẩn bị video", "optimizing");
    await waitForPaint();
    return {
      id: `${Date.now()}-${crypto.randomUUID()}`,
      name: file.name.replace(/\.[^/.]+$/, "") || "Video mới",
      kind: "video",
      blob: file,
      mimeType: file.type || "video/mp4",
      src,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      special: false,
      createdAt: Date.now(),
    };
  } catch (error) {
    URL.revokeObjectURL(src);
    throw error;
  }
}

function formatDuration(duration = 0) {
  const totalSeconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function mediaKindTitle(media: GalleryMedia) {
  return media.kind === "video" ? "Video kỷ niệm" : "Ảnh kỷ niệm";
}

function numberedMediaTitle(media: GalleryMedia, index: number) {
  return `${mediaKindTitle(media)} ${String(index + 1).padStart(2, "0")}`;
}

function mediaDetails(media: GalleryMedia) {
  const dimensions = `${media.width} × ${media.height}`;
  if (media.kind === "video") {
    return `${formatDuration(media.duration)} • ${dimensions}`;
  }
  return dimensions;
}

function cardGridStyle(media: GalleryMedia, occurrence: number): CSSProperties {
  const naturalRatio = media.width / Math.max(1, media.height);
  const variation = 1 + ((occurrence % 3) - 1) * 0.04;
  const ratio = Math.max(0.55, Math.min(1.7, naturalRatio * variation));

  const colSpan = media.special ? 2 : 1;
  const approxWidth = colSpan * 200 + (colSpan - 1) * 12;
  const approxHeight = approxWidth / ratio;
  const rowSpan = Math.max(6, Math.round((approxHeight + 12) / 22));

  return {
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${rowSpan}`,
    aspectRatio: `${ratio}`,
  };
}

function AutoPreviewVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!video || reduceMotion.matches || !("IntersectionObserver" in window)) {
      return;
    }

    let mounted = true;
    // Assigned after the callbacks are created because each callback closes over it.
    // eslint-disable-next-line prefer-const
    let registration: VideoPreviewRegistration;

    const stopPreview = () => {
      if (!registration.active && video.paused) return;
      registration.active = false;
      video.pause();
      if (video.readyState > 0) video.currentTime = 0;
      if (mounted) setIsPlaying(false);
    };

    const startPreview = () => {
      if (registration.active || videoPreviewsSuspended) return;
      registration.active = true;
      video.muted = true;

      void video.play()
        .then(() => {
          if (!mounted || !registration.active) {
            video.pause();
            return;
          }
          setIsPlaying(true);
        })
        .catch(() => {
          registration.active = false;
          registration.eligible = false;
          if (mounted) setIsPlaying(false);
          syncVideoPreviews();
        });
    };

    registration = {
      active: false,
      eligible: false,
      ratio: 0,
      start: startPreview,
      stop: stopPreview,
    };
    videoPreviewRegistry.add(registration);

    const observer = new IntersectionObserver(
      ([entry]) => {
        registration.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (registration.ratio >= VIDEO_PREVIEW_START_RATIO) {
          registration.eligible = true;
        } else if (!entry.isIntersecting || registration.ratio <= VIDEO_PREVIEW_STOP_RATIO) {
          registration.eligible = false;
        }
        syncVideoPreviews();
      },
      { threshold: [0, 0.08, 0.2, 0.35, 0.5, 0.75, 1] },
    );

    observer.observe(video);

    return () => {
      mounted = false;
      observer.disconnect();
      videoPreviewRegistry.delete(registration);
      registration.active = false;
      video.pause();
      if (video.readyState > 0) video.currentTime = 0;
      syncVideoPreviews();
    };
  }, [src]);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
      <span className={`video-badge${isPlaying ? " is-playing" : ""}`}>
        {isPlaying ? "ĐANG PHÁT" : "VIDEO"}
      </span>
    </>
  );
}

function RomanticEffects({ enabled }: { enabled: boolean }) {
  const trailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trail = trailRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!enabled || !trail || reduceMotion.matches) return;

    const interactiveSelector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "video",
      ".lightbox",
      ".delete-confirm-backdrop",
    ].join(",");
    let lastEmission = 0;
    let lastX = -100;
    let lastY = -100;
    let sequence = 0;
    let glowTimeout: number | undefined;

    const isBackground = (target: EventTarget | null) =>
      target instanceof Element && !target.closest(interactiveSelector);

    const setGlow = (x: number, y: number) => {
      document.documentElement.style.setProperty("--love-x", `${x}px`);
      document.documentElement.style.setProperty("--love-y", `${y}px`);
      document.documentElement.style.setProperty("--love-glow", "1");
      if (glowTimeout !== undefined) window.clearTimeout(glowTimeout);
      glowTimeout = window.setTimeout(() => {
        document.documentElement.style.setProperty("--love-glow", "0");
      }, 260);
    };

    const emitHearts = (x: number, y: number, amount: number, burst = false) => {
      while (trail.childElementCount > 32) {
        trail.firstElementChild?.remove();
      }

      for (let index = 0; index < amount; index += 1) {
        const heart = document.createElement("span");
        const spread = burst ? 42 + (index % 3) * 18 : 28;
        const angle = burst
          ? (Math.PI * 2 * index) / amount - Math.PI / 2
          : -Math.PI / 2 + ((sequence % 5) - 2) * 0.16;
        const driftX = Math.cos(angle) * spread;
        const driftY = Math.sin(angle) * spread - (burst ? 24 : 34);

        heart.className = `cursor-heart${burst ? " is-burst" : ""}`;
        heart.textContent = sequence % 3 === 0 ? "♡" : "♥";
        heart.style.left = `${x}px`;
        heart.style.top = `${y}px`;
        heart.style.setProperty("--trail-x", `${driftX}px`);
        heart.style.setProperty("--trail-y", `${driftY}px`);
        heart.style.setProperty("--trail-rotate", `${(sequence % 2 ? 1 : -1) * (18 + index * 7)}deg`);
        heart.style.setProperty("--trail-color", sequence % 4 === 0 ? "#8f294b" : "#e96f91");
        heart.addEventListener("animationend", () => heart.remove(), { once: true });
        trail.appendChild(heart);
        sequence += 1;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !isBackground(event.target)) {
        document.documentElement.style.setProperty("--love-glow", "0");
        return;
      }

      setGlow(event.clientX, event.clientY);
      const now = performance.now();
      const distance = Math.hypot(event.clientX - lastX, event.clientY - lastY);
      if (now - lastEmission < 82 || distance < 10) return;
      lastEmission = now;
      lastX = event.clientX;
      lastY = event.clientY;
      emitHearts(event.clientX, event.clientY, 1);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !isBackground(event.target)) return;
      setGlow(event.clientX, event.clientY);
      emitHearts(event.clientX, event.clientY, 8, true);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerDown);
      if (glowTimeout !== undefined) window.clearTimeout(glowTimeout);
      document.documentElement.style.removeProperty("--love-x");
      document.documentElement.style.removeProperty("--love-y");
      document.documentElement.style.removeProperty("--love-glow");
      trail.replaceChildren();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div className="love-cursor-glow" aria-hidden="true" />
      <div className="romantic-rain" aria-hidden="true">
        {ROMANTIC_PARTICLES.map((particle, index) => {
          const style: RomanticParticleStyle = {
            left: `${particle.left}%`,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            "--particle-size": `${particle.size}px`,
            "--particle-sway": `${particle.sway}px`,
            "--particle-spin": `${particle.spin}deg`,
          };

          return (
            <span
              className={`falling-item falling-${particle.kind}`}
              key={`${particle.kind}-${index}`}
              style={style}
            >
              {particle.kind === "heart" ? "♥" : particle.kind === "sparkle" ? "✦" : ""}
            </span>
          );
        })}
      </div>
      <div ref={trailRef} className="cursor-love-trail" aria-hidden="true" />
    </>
  );
}

function AnimatedHeadline() {
  const [phase, setPhase] = useState<HeadlinePhase>("typing-story");
  const [characterCount, setCharacterCount] = useState(0);
  const storyLength = STORY_LEAD.length + STORY_ACCENT.length;
  const showingStory = phase.endsWith("story");
  const filledHearts = showingStory
    ? 0
    : LOVE_HEART_MILESTONES.filter((milestone) => characterCount >= milestone).length;
  const leadText = STORY_LEAD.slice(0, Math.min(characterCount, STORY_LEAD.length));
  const accentText = STORY_ACCENT.slice(
    0,
    Math.max(0, characterCount - STORY_LEAD.length),
  );
  const loveText = LOVE_MESSAGE.slice(0, characterCount);

  useEffect(() => {
    let timeout: number;
    const schedule = (callback: () => void, delay: number) => {
      timeout = window.setTimeout(callback, delay);
    };

    if (phase === "typing-story") {
      if (characterCount < storyLength) {
        const isLineBreak = characterCount === STORY_LEAD.length;
        const humanDelay = 44 + (characterCount % 4) * 7;
        schedule(() => setCharacterCount((count) => count + 1), isLineBreak ? 240 : humanDelay);
      } else {
        schedule(() => setPhase("holding-story"), 1800);
      }
    } else if (phase === "holding-story") {
      schedule(() => setPhase("deleting-story"), 1);
    } else if (phase === "deleting-story") {
      if (characterCount > 0) {
        schedule(() => setCharacterCount((count) => count - 1), 24);
      } else {
        schedule(() => setPhase("typing-love"), 280);
      }
    } else if (phase === "typing-love") {
      if (characterCount < LOVE_MESSAGE.length) {
        schedule(() => setCharacterCount((count) => count + 1), 92);
      } else {
        schedule(() => setPhase("holding-love"), 520);
      }
    } else if (phase === "holding-love") {
      schedule(() => setPhase("deleting-love"), 2800);
    } else if (characterCount > 0) {
      schedule(() => setCharacterCount((count) => count - 1), 38);
    } else {
      schedule(() => {
        setPhase("typing-story");
      }, 520);
    }

    return () => window.clearTimeout(timeout);
  }, [characterCount, phase, storyLength]);

  return (
    <h1
      id="page-title"
      className={`kinetic-headline phase-${phase}`}
      aria-label="Gom từng khoảnh khắc, giữ cả chuyện chúng mình. Anh yêu em."
    >
      <span className="animated-headline-copy" aria-hidden="true">
        {showingStory ? (
          <span className="headline-story">
            <span className="headline-lead">
              {leadText || "\u00A0"}
              {characterCount <= STORY_LEAD.length && <span className="type-caret" />}
            </span>
            <em className="headline-accent">
              {accentText || "\u00A0"}
              {characterCount > STORY_LEAD.length && <span className="type-caret" />}
            </em>
          </span>
        ) : (
          <span className="headline-love">
            <span className="love-message">
              {loveText || "\u00A0"}
              <span className="type-caret" />
            </span>
            <span className="love-hearts">
              {[0, 1, 2].map((index) => (
                <span
                  className={`love-heart${index < filledHearts ? " is-filled" : ""}`}
                  key={index}
                >
                  <Heart className="love-heart-outline" weight="regular" aria-hidden="true" />
                  <Heart className="love-heart-fill" weight="fill" aria-hidden="true" />
                </span>
              ))}
            </span>
          </span>
        )}
      </span>
      <span className="reduced-motion-headline" aria-hidden="true">
        Gom từng khoảnh khắc,
        <em>giữ cả chuyện chúng mình.</em>
      </span>
    </h1>
  );
}

// ==========================================================================
// ROMANTIC SOUND EFFECTS & MUSIC HELPERS
// ==========================================================================

function playWaxSealSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(240, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {}
}

function playPaperRustleSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1100, ctx.currentTime);
    filter.Q.setValueAtTime(1.5, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch {}
}

function playTypingSound(charIndex: number) {
  try {
    if (charIndex % 3 !== 0) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 880.0, 1046.5];
    const freq = notes[charIndex % notes.length];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

function playHeartBurstSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.06);
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.06 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.06);
      osc.stop(ctx.currentTime + i * 0.06 + 0.25);
    });
  } catch {}
}

// ==========================================================================
// FEATURE 1: HEART FIREWORKS BURST
// ==========================================================================

function HeartFireworks({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<
    Array<{ id: number; dx: string; dy: string; rot: string; size: string; color: string; symbol: string }>
  >([]);

  useEffect(() => {
    if (!active) return;

    playHeartBurstSound();

    const symbols = ["♥", "✦", "🌸", "♥", "✨"];
    const colors = ["#e64c72", "#f07d9e", "#ffd7e2", "#ff4055", "#e96f91"];

    const newParticles = Array.from({ length: 32 }, (_, i) => {
      const angle = (i / 32) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
      const distance = 120 + Math.random() * 180;
      const dx = `${Math.cos(angle) * distance}px`;
      const dy = `${Math.sin(angle) * distance}px`;
      const rot = `${(Math.random() * 2 - 1) * 60}deg`;
      const size = `${16 + Math.random() * 14}px`;
      const color = colors[i % colors.length];
      const symbol = symbols[i % symbols.length];

      return { id: i, dx, dy, rot, size, color, symbol };
    });

    setParticles(newParticles);
  }, [active]);

  if (!active || !particles.length) return null;

  return (
    <div className="heart-fireworks-container" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="firework-particle"
          style={
            {
              "--dx": p.dx,
              "--dy": p.dy,
              "--rot": p.rot,
              "--p-size": p.size,
              "--p-color": p.color,
            } as CSSProperties
          }
        >
          {p.symbol}
        </span>
      ))}
    </div>
  );
}

// ==========================================================================
// FEATURE 4: INTERACTIVE 3D FLIPPABLE POLAROID CARD
// ==========================================================================

function PolaroidCard() {
  const [isFlipped, setIsFlipped] = useState(false);
  const polaroidInputRef = useRef<HTMLInputElement>(null);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);

  useEffect(() => {
    const savedPhoto = localStorage.getItem("lap-gallery-polaroid-photo");
    if (savedPhoto) setPhotoSrc(savedPhoto);

    getSupabaseSetting("polaroid_photo").then((url) => {
      if (url) setPhotoSrc(url);
    });

    const channel = supabase
      .channel("polaroid_setting_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          if (payload.new && (payload.new as { key: string; value: string }).key === "polaroid_photo") {
            setPhotoSrc((payload.new as { key: string; value: string }).value);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPhotoSrc(dataUrl);
      localStorage.setItem("lap-gallery-polaroid-photo", dataUrl);
      try {
        const publicUrl = await uploadToSupabaseStorage(file, `polaroid_${file.name}`);
        setPhotoSrc(publicUrl);
        await setSupabaseSetting("polaroid_photo", publicUrl);
      } catch (err) {
        console.error("Failed to upload polaroid to Supabase:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={`polaroid-3d-card${isFlipped ? " is-flipped" : ""}`}
      title={photoSrc ? "Nhấp để lật xem lời nhắn bí mật ♥" : "Nhấp để chọn ảnh kỷ niệm ♥"}
    >
      <input
        ref={polaroidInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handlePhotoUpload}
      />
      <div className="polaroid-inner">
        <div className="polaroid-front">
          <div
            className="polaroid-photo-frame"
            onClick={(e) => {
              e.stopPropagation();
              if (!photoSrc) {
                polaroidInputRef.current?.click();
              } else {
                setIsFlipped(true);
              }
            }}
          >
            {photoSrc ? (
              <img src={photoSrc} alt="Kỷ niệm của chúng mình" />
            ) : (
              <div className="polaroid-photo-placeholder">
                <span style={{ fontSize: "28px" }}>📷</span>
                <span>Chọn ảnh kỷ niệm</span>
              </div>
            )}
          </div>
          <p className="polaroid-caption">{photoSrc ? "Góc kỷ niệm ♥" : "Thêm ảnh ♥"}</p>
        </div>
        <div
          className="polaroid-back"
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
          }}
        >
          <p className="polaroid-back-text">
            "Ngày đầu tiên bên em, anh biết em chính là mảnh ghép định mệnh của anh..."
          </p>
          <span className="polaroid-back-heart">♥</span>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// FEATURE 3: LOVE DAYS COUNTER HELPER & MODAL
// ==========================================================================

function calculateLoveDays(startDateStr: string): number {
  try {
    const start = new Date(startDateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    return Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  } catch {
    return 520;
  }
}

function LoveDateModal({
  currentDate,
  onSave,
  onClose,
}: {
  currentDate: string;
  onSave: (date: string) => void;
  onClose: () => void;
}) {
  const [dateVal, setDateVal] = useState(currentDate);

  return (
    <div className="love-days-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="love-days-dialog">
        <h3>Ngày Kỷ Niệm Yêu Nhau ♥</h3>
        <p>Chọn ngày hai đứa bắt đầu yêu nhau để đếm số ngày kỷ niệm:</p>
        <input
          type="date"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
        />
        <div className="love-days-dialog-actions">
          <button
            className="dialog-button dialog-button-secondary"
            type="button"
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            className="dialog-button dialog-button-primary"
            type="button"
            onClick={() => {
              onSave(dateVal);
              onClose();
            }}
          >
            Lưu kỷ niệm
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// FEATURE 5: VOICEOVER AUDIO PLAYER WIDGET
// ==========================================================================

function VoiceoverWidget({
  bgmRef,
  onProgress,
  autoPlay,
}: {
  bgmRef: React.RefObject<HTMLVideoElement | null>;
  onProgress?: (progress: number, isPlaying: boolean, isEnded: boolean) => void;
  autoPlay?: boolean;
}) {
  const [voiceSrc, setVoiceSrc] = useState<string>("/0808.mp4");
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isFinishedRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem("lap-gallery-voiceover");
    if (saved) setVoiceSrc(saved);
    else setVoiceSrc("/0808.mp4");

    getSupabaseSetting("voiceover").then((url) => {
      if (url) setVoiceSrc(url);
    });

    const channel = supabase
      .channel("voiceover_setting_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          if (payload.new && (payload.new as { key: string; value: string }).key === "voiceover") {
            setVoiceSrc((payload.new as { key: string; value: string }).value);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setVoiceSrc(dataUrl);
      localStorage.setItem("lap-gallery-voiceover", dataUrl);
      try {
        const publicUrl = await uploadToSupabaseStorage(file, `voiceover_${file.name}`);
        setVoiceSrc(publicUrl);
        await setSupabaseSetting("voiceover", publicUrl);
      } catch (err) {
        console.error("Failed to upload voiceover to Supabase:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  const togglePlay = () => {
    if (!audioRef.current || !voiceSrc) return;
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      if (bgmRef.current) bgmRef.current.volume = 0.45;
    } else {
      if (bgmRef.current) bgmRef.current.volume = 0.12;
      
      if (isFinishedRef.current || audio.ended || audio.currentTime >= audio.duration * 0.95) {
        audio.currentTime = 0;
        isFinishedRef.current = false;
        onProgress?.(0, true, false);
      } else {
        isFinishedRef.current = false;
      }
      
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error("Voiceover play error:", err);
        });
    }
  };

  useEffect(() => {
    if (!autoPlay || !audioRef.current || !voiceSrc) return;
    const audio = audioRef.current;

    const tryAutoPlay = () => {
      if (bgmRef.current) bgmRef.current.volume = 0.12;
      isFinishedRef.current = false;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          // Autoplay blocked by browser policy — user can click Play manually
          if (bgmRef.current) bgmRef.current.volume = 0.45;
        });
    };

    if (audio.readyState >= 2) {
      tryAutoPlay();
    } else {
      audio.addEventListener("canplay", tryAutoPlay, { once: true });
      return () => audio.removeEventListener("canplay", tryAutoPlay);
    }
  }, [autoPlay, voiceSrc]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const progress = audio.currentTime / audio.duration;

    if (progress >= 0.965 && !isFinishedRef.current) {
      isFinishedRef.current = true;
      audio.pause();
      setIsPlaying(false);
      if (bgmRef.current) bgmRef.current.volume = 0.45;
      onProgress?.(1, false, true);
      return;
    }

    if (!isFinishedRef.current) {
      onProgress?.(progress, true, false);
    }
  };

  const resetToDefaultVoice = async () => {
    setVoiceSrc("/0808.mp4");
    localStorage.removeItem("lap-gallery-voiceover");
    try {
      await setSupabaseSetting("voiceover", "/0808.mp4");
    } catch (e) {
      console.error("Failed to reset voiceover:", e);
    }
  };

  return (
    <div className={`voiceover-widget${isPlaying ? " is-playing" : ""}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
      {voiceSrc && (
        <audio
          ref={audioRef}
          src={voiceSrc}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            if (bgmRef.current) bgmRef.current.volume = 0.45;
            onProgress?.(1, false, true);
          }}
        />
      )}
      <div className="voiceover-header">
        <span className="voiceover-title">
          <span>🎙️</span>
          <span>{voiceSrc ? "Lời đọc của anh" : "Giọng đọc truyền cảm"}</span>
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            className="voiceover-upload-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            {voiceSrc && voiceSrc !== "/0808.mp4" ? "Đổi ghi âm 🎙️" : "Tải lên ghi âm 🎙️"}
          </button>
          {voiceSrc && voiceSrc !== "/0808.mp4" && (
            <button
              className="voiceover-upload-btn"
              type="button"
              onClick={resetToDefaultVoice}
              title="Khôi phục lại đoạn ghi âm giọng đọc mặc định ban đầu"
              style={{ background: "rgba(255, 255, 255, 0.7)", color: "#8c2545" }}
            >
              Đặt lại gốc 🔄
            </button>
          )}
        </div>
      </div>

      {voiceSrc ? (
        <div className="voiceover-controls">
          <button
            className="voiceover-play-btn"
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Tạm dừng" : "Phát giọng đọc"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <div className="voiceover-waves" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="voiceover-wave-bar" />
            ))}
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "13px", color: "#8c2545", opacity: 0.85 }}>
          Nhấp vào "Tải lên ghi âm giọng đọc" để chọn file ghi âm lời thì thầm bằng giọng nói của bạn dành cho em ♥
        </p>
      )}
    </div>
  );
}

// ==========================================================================
// LOVE LETTER TEXT DEFINITIONS
// ==========================================================================

const LETTER_POEM_TEXT =
  "Ta yêu nhau tự cuối đông,\nXuân về e ấp má hồng dịu êm.\nHạ qua nắng hạ bên thềm,\nThu sang chạm nhẹ tơ mềm đắm say.\nĐông về rét mướt heo may,\nBốn mùa trôi qua, tay vẫn trong tay.";

const LETTER_QUOTE_TEXT =
  "Thực ra thế giới của anh rất nhỏ bé. Nhỏ đến mức mọi ngả đường anh đi đều dẫn về phía em, và mọi lựa chọn khác ngoài em đều trở nên vô nghĩa...";

type LetterPhase =
  | "closed"
  | "opening"
  | "extracting"
  | "unfolded"
  | "closing-envelope-up"
  | "closing-folding"
  | "closing-seal"
  | "closing-glide";

function LoveLetterIntro({
  loveDays,
  onOpenDateModal,
  onClose,
}: {
  loveDays: number;
  onOpenDateModal: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<LetterPhase>("closed");
  const [typedCharCount, setTypedCharCount] = useState(0);
  const [typedCharCountP2, setTypedCharCountP2] = useState(0);
  const [hasVoicePlayed, setHasVoicePlayed] = useState(false);
  const [letterPage, setLetterPage] = useState<1 | 2>(1);
  const bgmRef = useRef<HTMLVideoElement>(null);
  const [bgmReady, setBgmReady] = useState(false);

  const totalChars1 = LETTER_POEM_TEXT.length;
  const isTypingDone1 = typedCharCount >= totalChars1;

  const totalChars2 = LETTER_QUOTE_TEXT.length;
  const isTypingDone2 = typedCharCountP2 >= totalChars2;

  const handleVoiceProgress = (progress: number, isPlaying: boolean, isEnded: boolean) => {
    setHasVoicePlayed(true);
    if (isEnded || progress >= 0.965) {
      setTypedCharCountP2(totalChars2);
    } else {
      const targetCount = Math.min(totalChars2, Math.floor(progress * totalChars2));
      setTypedCharCountP2((prev) => (progress === 0 ? prev : Math.max(prev, targetCount)));
    }
  };

  // Auto-play background music on mount (loop)
  useEffect(() => {
    const vid = bgmRef.current;
    if (!vid) return;
    vid.volume = 0.45;
    vid.loop = true;
    const tryPlay = () => {
      vid.play().then(() => setBgmReady(true)).catch(() => {
        // Autoplay blocked — will play on first user click
      });
    };
    tryPlay();

    // Fallback: play on first user interaction if autoplay was blocked
    const handleInteraction = () => {
      if (vid.paused) {
        vid.play().then(() => setBgmReady(true)).catch(() => {});
      }
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
    };
    document.addEventListener("click", handleInteraction, { once: true });
    document.addEventListener("touchstart", handleInteraction, { once: true });

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
    };
  }, []);

  // 4-Phase Cinematic Reverse Closing Sequence & Music Sync
  const handleClose = () => {
    if (phase.startsWith("closing")) return;

    // Start background music volume fade out over exact duration (2100ms)
    const vid = bgmRef.current;
    if (vid && !vid.paused) {
      const initialVol = vid.volume;
      const startTime = Date.now();
      const fadeDuration = 2100;

      const fadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / fadeDuration);
        vid.volume = Math.max(0, initialVol * (1 - progress));

        if (progress >= 1) {
          clearInterval(fadeInterval);
          vid.pause();
          vid.currentTime = 0;
        }
      }, 25);
    }

    // Step 1: Envelope glides up from bottom so top opening touches base of letter (0ms -> 500ms)
    setPhase("closing-envelope-up");

    // Step 2: Letter paper glides down INTO envelope pocket behind front flaps (500ms -> 1050ms)
    setTimeout(() => {
      setPhase("closing-folding");
    }, 500);

    // Step 3: Top flap folds 180deg back down & wax seal seals (1050ms -> 1550ms)
    setTimeout(() => {
      setPhase("closing-seal");
    }, 1050);

    // Step 4: Sealed envelope shrinks & glides to exact sidebar navbar letter button (✉) (1550ms -> 2150ms)
    setTimeout(() => {
      setPhase("closing-glide");
    }, 1550);

    // Final: Envelope lands on navbar button, audio reaches 0, unmount intro modal (2150ms)
    setTimeout(() => {
      onClose();
    }, 2150);
  };

  const handleOpen = () => {
    if (phase !== "closed") return;
    if (bgmRef.current && bgmRef.current.paused) {
      bgmRef.current.volume = 0.45;
      bgmRef.current.play().then(() => setBgmReady(true)).catch(() => {});
    }
    setPhase("opening");

    // Phase 2: Pull letter paper upwards out of envelope (after 450ms)
    setTimeout(() => {
      setPhase("extracting");
    }, 450);

    // Phase 3: Smoothly transition to full reading paper & typewriter (after 1000ms)
    setTimeout(() => {
      setPhase("unfolded");
    }, 1000);
  };

  // Lock body scroll while letter intro is active
  useEffect(() => {
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  // Typewriter effect interval for Page 1
  useEffect(() => {
    if (phase !== "unfolded" || letterPage !== 1) return;

    const timer = setInterval(() => {
      setTypedCharCount((prev) => {
        if (prev >= totalChars1) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 140);

    return () => clearInterval(timer);
  }, [phase, letterPage, totalChars1]);

  // Typewriter effect interval for Page 2 (types out steadily + syncs with voice)
  useEffect(() => {
    if (phase !== "unfolded" || letterPage !== 2) return;

    const timer = setInterval(() => {
      setTypedCharCountP2((prev) => {
        if (prev >= totalChars2) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [phase, letterPage, totalChars2]);

  const isEnvelopeOpen =
    phase === "opening" ||
    phase === "extracting" ||
    phase === "unfolded" ||
    phase === "closing-envelope-up" ||
    phase === "closing-folding";

  // Calculate typed texts
  const poemTyped = LETTER_POEM_TEXT.slice(0, typedCharCount);
  const quoteTyped = LETTER_QUOTE_TEXT.slice(0, typedCharCountP2);

  return (
    <div
      className={`love-letter-backdrop phase-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Lá thư tình yêu"
    >
      {/* Background Music */}
      <video
        ref={bgmRef}
        src="/Download.mp4"
        loop
        playsInline
        style={{ display: "none" }}
      />

      <div className={`love-letter-scene phase-${phase}`}>
        {/* Feature 1: Heart Fireworks Burst on Typing Complete */}
        <HeartFireworks active={isTypingDone2 && letterPage === 2} />

        {/* 3D Envelope Structure */}
        <div className="envelope-3d-wrapper">
          <div
            className={`envelope-3d-box${isEnvelopeOpen ? " is-open" : ""}`}
            role="button"
            tabIndex={0}
            onClick={handleOpen}
            onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            aria-label="Mở lá thư 3D"
          >
            {/* 3D Envelope Backing */}
            <div className="envelope-3d-back" />

            {/* 3D Folding Flaps */}
            <div className="envelope-3d-left" />
            <div className="envelope-3d-right" />
            <div className="envelope-3d-bottom" />
            <div className="envelope-3d-top" />

            {/* Wax Seal holding top flap */}
            <div className="wax-seal-3d" aria-hidden="true">
              ♥
            </div>
          </div>
        </div>

        {!isEnvelopeOpen && (
          <span className="envelope-prompt-badge">
            <span>✉</span> Chạm nhẹ vào tem sáp để mở lá thư ♥
          </span>
        )}

        {/* Continuous Single-Paper Sheet */}
        <div className="continuous-letter-paper">
          {/* Feature 4: Interactive 3D Polaroid Card */}
          <PolaroidCard />

          <div className="letter-header">
            <button
              className="love-days-badge"
              type="button"
              onClick={onOpenDateModal}
              title="Nhấp để thay đổi ngày kỷ niệm yêu nhau"
            >
              <span aria-hidden="true">♥</span>
              <span>Bên nhau {loveDays} ngày</span>
            </button>
            <span className="letter-heart-icon">✦</span>
          </div>

          <div className="letter-page-container">
            {letterPage === 1 ? (
              <div className="letter-page key-page-1">
                <div className="letter-body">
                  <h3 className="letter-salutation">Gửi Em,</h3>
                  <p className="letter-paragraph" style={{ whiteSpace: "pre-line" }}>
                    {poemTyped}
                    {phase === "unfolded" && !isTypingDone1 && (
                      <span className="type-caret-heart">♥</span>
                    )}
                  </p>
                </div>

                <div className={`letter-actions${isTypingDone1 ? " is-visible" : " is-hidden"}`}>
                  <button
                    className="letter-next-btn"
                    type="button"
                    onClick={() => setLetterPage(2)}
                  >
                    <span>Trang tiếp theo</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="letter-page key-page-2">
                <div className="letter-body">
                  <p className="letter-paragraph">
                    "{quoteTyped}"
                    {!isTypingDone2 && <span className="type-caret-heart">♥</span>}
                  </p>

                  {/* Feature 5: Interactive Voiceover Audio Player Widget */}
                  <VoiceoverWidget
                    bgmRef={bgmRef}
                    onProgress={handleVoiceProgress}
                    autoPlay={true}
                  />

                  {isTypingDone2 && (
                    <p className="letter-signature">Anh Yêu Em ♥</p>
                  )}
                </div>

                <div className={`letter-actions${isTypingDone2 ? " is-visible" : " is-hidden"}`} style={{ marginTop: "24px" }}>
                  <button
                    className="letter-next-btn"
                    type="button"
                    onClick={handleClose}
                  >
                    <span>Xem kỷ niệm của chúng mình</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const mediaRef = useRef<GalleryMedia[]>([]);
  const [mediaItems, setMediaItems] = useState<GalleryMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tileCount, setTileCount] = useState(42);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [preview, setPreview] = useState<GalleryMedia | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [uploadBatch, setUploadBatch] = useState<UploadBatch | null>(null);
  const [contextMenu, setContextMenu] = useState<MediaContextMenu | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [loveDateStr, setLoveDateStr] = useState("2026-01-24");
  const [showDateModal, setShowDateModal] = useState(false);
  const loveDays = calculateLoveDays(loveDateStr);

  useEffect(() => {
    let disposed = false;
    const storedCount = Number(localStorage.getItem("lap-gallery-count"));
    const storedLoveDate = localStorage.getItem("lap-gallery-love-date");
    if (storedLoveDate) setLoveDateStr(storedLoveDate);
    if (COUNT_OPTIONS.includes(storedCount)) setTileCount(storedCount);
    if (localStorage.getItem("lap-gallery-effects") === "off") {
      setEffectsEnabled(false);
    }

    getSupabaseSetting("love_date").then((date) => {
      if (date && !disposed) setLoveDateStr(date);
    });

    const syncMedia = async () => {
      try {
        const supaItems = await fetchSupabaseMedia();
        if (disposed) return;
        if (supaItems.length > 0) {
          setMediaItems(
            supaItems.map((item) => ({
              id: item.id,
              name: item.name,
              kind: item.kind,
              mimeType: item.mime_type || "image/webp",
              src: item.url,
              width: item.width || 800,
              height: item.height || 600,
              duration: item.duration,
              special: item.special,
              createdAt: item.created_at,
            }))
          );
        } else {
          const localItems = await readMedia();
          if (!disposed && localItems.length > 0) {
            setMediaItems(localItems);
            // Migrate local items to Supabase storage & database
            for (const item of localItems) {
              try {
                let publicUrl = item.src;
                if (item.blob || (item.dataUrl && item.dataUrl.startsWith("data:"))) {
                  const blobToUpload = item.blob || (await (await fetch(item.dataUrl!)).blob());
                  publicUrl = await uploadToSupabaseStorage(
                    blobToUpload,
                    `${item.id}_${item.name}`,
                    item.mimeType
                  );
                }
                await insertSupabaseMedia({
                  id: item.id,
                  name: item.name,
                  kind: item.kind,
                  url: publicUrl,
                  mime_type: item.mimeType,
                  width: item.width,
                  height: item.height,
                  duration: item.duration,
                  special: item.special,
                  created_at: item.createdAt,
                });
              } catch (err) {
                console.error("Failed to migrate item to Supabase:", item.name, err);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error reading Supabase media:", err);
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    syncMedia();

    const channel = supabase
      .channel("public_media_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gallery_media" },
        () => {
          fetchSupabaseMedia().then((items) => {
            if (!disposed) {
              setMediaItems(
                items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  kind: item.kind,
                  mimeType: item.mime_type || "image/webp",
                  src: item.url,
                  width: item.width || 800,
                  height: item.height || 600,
                  duration: item.duration,
                  special: item.special,
                  createdAt: item.created_at,
                }))
              );
            }
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          if (payload.new && (payload.new as { key: string; value: string }).key === "love_date") {
            if (!disposed) setLoveDateStr((payload.new as { key: string; value: string }).value);
          }
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    mediaRef.current = mediaItems;
  }, [mediaItems]);

  useEffect(() => {
    setVideoPreviewsSuspended(Boolean(preview));
  }, [preview]);

  useEffect(() => () => {
    mediaRef.current.forEach((item) => {
      if (item.kind === "video") URL.revokeObjectURL(item.src);
    });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (isAdding || !uploadBatch || uploadTasks.length > 0) return;
    const timeout = window.setTimeout(() => setUploadBatch(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [isAdding, uploadBatch, uploadTasks.length]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const menuEl = document.querySelector(".media-context-menu");
      if (menuEl && target && menuEl.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    const handleClose = () => setContextMenu(null);

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (deleteIntent && !isDeleting) {
        setDeleteIntent(null);
        return;
      }
      setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [contextMenu, deleteIntent, isDeleting]);

  useEffect(() => {
    if (deleteIntent) deleteCancelButtonRef.current?.focus();
  }, [deleteIntent]);

  const filteredMedia = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    if (!normalizedQuery) return mediaItems;
    return mediaItems.filter((media) =>
      media.name.toLocaleLowerCase("vi").includes(normalizedQuery),
    );
  }, [mediaItems, query]);

  const temporaryCount = useMemo(
    () => mediaItems.filter((media) => media.temporary).length,
    [mediaItems],
  );

  const uploadDoneCount = useMemo(
    () => uploadBatch?.processed ?? 0,
    [uploadBatch],
  );

  const uploadErrorCount = useMemo(
    () => uploadBatch?.errors ?? uploadTasks.filter((task) => task.status === "error").length,
    [uploadBatch, uploadTasks],
  );
  const uploadActiveCount = useMemo(
    () => uploadTasks.filter((task) => UPLOAD_ACTIVE_STATUSES.has(task.status)).length,
    [uploadTasks],
  );
  const uploadQueuedCount = useMemo(
    () => uploadTasks.filter((task) => task.status === "queued").length,
    [uploadTasks],
  );

  const feed = useMemo(() => {
    if (!filteredMedia.length) return [];
    const frameCount = Math.max(tileCount, filteredMedia.length + tileCount);
    return Array.from({ length: frameCount }, (_, index) => {
      const media = filteredMedia[index % filteredMedia.length];
      return {
        media,
        occurrence: Math.floor(index / filteredMedia.length),
        key: `${media.id}-${index}`,
      };
    });
  }, [filteredMedia, tileCount]);

  const repeatedFrameCount = feed.length;

  const addFiles = async (files: File[]) => {
    if (isAdding) {
      setNotice("Đợi đợt đang thêm xong rồi thêm tiếp nhé.");
      return;
    }

    const supportedFiles = files.filter((file) => isImageFile(file) || isVideoFile(file));
    if (!supportedFiles.length) {
      setNotice("Không tìm thấy ảnh hoặc video có định dạng được hỗ trợ.");
      return;
    }

    const initialTasks = supportedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${crypto.randomUUID()}`,
      title: uploadTaskTitle(file, index),
      fileName: file.name || `Tệp ${index + 1}`,
      fileSizeLabel: formatFileSize(file.size),
      kind: mediaKindForFile(file),
      progress: 4,
      status: "queued" as UploadTaskStatus,
      detail: "Đang chờ xử lý",
    }));
    const updateUploadTask = (id: string, patch: Partial<UploadTask>) => {
      setUploadTasks((tasks) =>
        tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      );
    };
    const finishUploadTask = (id: string, failed = false) => {
      setUploadBatch((batch) =>
        batch
          ? {
              ...batch,
              processed: Math.min(batch.total, batch.processed + 1),
              errors: batch.errors + (failed ? 1 : 0),
            }
          : batch,
      );
      if (!failed) {
        window.setTimeout(() => {
          setUploadTasks((tasks) => tasks.filter((task) => task.id !== id));
        }, 650);
      }
    };

    setIsAdding(true);
    setManagerOpen(true);
    setUploadTasks(initialTasks);
    setUploadBatch({
      total: initialTasks.length,
      processed: 0,
      errors: 0,
    });
    await waitForPaint();

    const added: GalleryMedia[] = [];
    const unsupported = files.length - supportedFiles.length;
    let unreadable = 0;
    let temporary = 0;

    try {
      await navigator.storage?.persist?.();
    } catch {
      // The import can continue even when persistent storage is unavailable.
    }

    const uploadJobs = supportedFiles.map((file, index) => ({
      file,
      task: initialTasks[index],
    }));
    const imageJobs = uploadJobs.filter((job) => job.task.kind === "image");
    const videoJobs = uploadJobs.filter((job) => job.task.kind === "video");

    const processUploadJob = async ({
      file,
      task,
    }: {
      file: File;
      task: UploadTask;
    }) => {
      let prepared: GalleryMedia | undefined;
      updateUploadTask(task.id, {
        progress: 12,
        status: "reading",
        detail: file.type.startsWith("video/") || isVideoFile(file)
          ? "Đang mở video"
          : "Đang mở ảnh",
      });
      await waitForPaint();

      try {
        prepared = isVideoFile(file)
          ? await prepareVideo(file, (progress, detail, status) => {
              updateUploadTask(task.id, { progress, detail, status: status ?? "reading" });
            })
          : await prepareImage(file, (progress, detail, status) => {
              updateUploadTask(task.id, { progress, detail, status: status ?? "reading" });
            });
      } catch {
        unreadable += 1;
        updateUploadTask(task.id, {
          progress: 100,
          status: "error",
          detail: "Không đọc được mục này",
        });
        finishUploadTask(task.id, true);
        await waitForPaint();
        return;
      }

      updateUploadTask(task.id, {
        progress: 88,
        status: "saving",
        detail: "Đang tải lên mây Supabase",
      });
      await waitForPaint();

      try {
        await saveMedia(prepared);
        let publicUrl = prepared.src;
        const blobToUpload = prepared.blob || (prepared.dataUrl ? await (await fetch(prepared.dataUrl)).blob() : null);
        if (blobToUpload) {
          publicUrl = await uploadToSupabaseStorage(
            blobToUpload,
            `${prepared.id}_${prepared.name}`,
            prepared.mimeType
          );
        }
        await insertSupabaseMedia({
          id: prepared.id,
          name: prepared.name,
          kind: prepared.kind,
          url: publicUrl,
          mime_type: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          duration: prepared.duration,
          special: prepared.special,
          created_at: prepared.createdAt,
        });
        prepared = { ...prepared, src: publicUrl };

        updateUploadTask(task.id, {
          progress: 100,
          status: "complete",
          detail: "Đã thêm vào thư viện mây",
        });
        finishUploadTask(task.id);
      } catch (err) {
        console.error("Supabase upload error:", err);
        prepared = { ...prepared, temporary: true };
        temporary += 1;
        updateUploadTask(task.id, {
          progress: 100,
          status: "complete",
          detail: "Đã thêm vào bộ nhớ",
        });
        finishUploadTask(task.id);
      }
      added.push(prepared);
      setMediaItems((current) => [...current, prepared]);
      await waitForPaint();
    };

    await Promise.all([
      runLimitedQueue(imageJobs, UPLOAD_IMAGE_CONCURRENCY, processUploadJob),
      runLimitedQueue(videoJobs, UPLOAD_VIDEO_CONCURRENCY, processUploadJob),
    ]);

    setIsAdding(false);

    const details = [
      temporary ? `${temporary} mục chỉ lưu trong phiên này vì bộ nhớ lâu dài đã đầy` : "",
      unreadable ? `${unreadable} tệp không đọc được` : "",
      unsupported ? `${unsupported} tệp không đúng định dạng` : "",
    ].filter(Boolean);

    if (!added.length) {
      setNotice(`Không thêm được khoảnh khắc nào. ${details.join(" • ")}.`);
    } else if (details.length) {
      setNotice(`Đã thêm ${added.length} mục. ${details.join(" • ")}.`);
    } else {
      setNotice(`Đã thêm ${added.length} mục vào bảng.`);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const toggleSpecial = async (id: string) => {
    const current = mediaItems.find((media) => media.id === id);
    if (!current) return;
    const nextSpecial = !current.special;
    const updated = { ...current, special: nextSpecial };
    setMediaItems((items) =>
      items.map((media) => (media.id === id ? updated : media)),
    );
    setPreview((currentPreview) =>
      currentPreview?.id === id ? updated : currentPreview,
    );
    try {
      await saveMedia(updated);
      await updateSupabaseMediaSpecial(id, nextSpecial);
      setNotice(
        updated.special
          ? "Khoảnh khắc này đã thành nội dung đặc biệt ♥"
          : "Khoảnh khắc này đã trở về ô thường.",
      );
    } catch {
      setNotice("Thay đổi đã áp dụng.");
    }
  };

  const confirmDeletion = async () => {
    if (!deleteIntent || isDeleting) return;
    const intent = deleteIntent;
    setIsDeleting(true);

    try {
      if (intent.kind === "single") {
        const { media } = intent;
        await removeMedia(media.id);
        await deleteSupabaseMedia(media.id);
        setPreview((current) => current?.id === media.id ? null : current);
        setMediaItems((items) => items.filter((item) => item.id !== media.id));
        if (media.kind === "video") URL.revokeObjectURL(media.src);
        setNotice("Đã xóa một khoảnh khắc.");
      } else {
        const removedItems = [...mediaRef.current];
        await clearMedia();
        await clearSupabaseMedia();
        setPreview(null);
        setMediaItems([]);
        removedItems.forEach((item) => {
          if (item.kind === "video") URL.revokeObjectURL(item.src);
        });
        setNotice(`Đã xóa toàn bộ ${removedItems.length} khoảnh khắc.`);
      }
    } catch {
      setNotice("Chưa thể xóa mục này.");
    } finally {
      setIsDeleting(false);
      setDeleteIntent(null);
    }
  };

  const chooseCount = (count: number) => {
    setTileCount(count);
    localStorage.setItem("lap-gallery-count", String(count));
  };

  const shuffleMedia = () => {
    if (mediaItems.length < 2) {
      setNotice("Cần ít nhất 2 khoảnh khắc để xáo trộn.");
      return;
    }
    setContextMenu(null);
    setMediaItems((current) => {
      const shuffled = [...current];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      return shuffled;
    });
    setNotice("Đã xáo trộn bố cục kỷ niệm cho đoạn quay mới.");
  };

  const toggleEffects = () => {
    const nextEnabled = !effectsEnabled;
    setEffectsEnabled(nextEnabled);
    localStorage.setItem("lap-gallery-effects", nextEnabled ? "on" : "off");
    setNotice(nextEnabled ? "Hiệu ứng tình yêu đã bật ♥" : "Đã tạm dừng hiệu ứng nền.");
  };

  const openCard = (media: GalleryMedia) => {
    setContextMenu(null);
    setPreview(media);
  };

  const openMediaMenu = (
    event: MouseEvent<HTMLElement>,
    media: GalleryMedia,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 112;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({
      media,
      x: Math.max(12, x),
      y: Math.max(12, y),
    });
  };

  const onCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    media: GalleryMedia,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCard(media);
    }
  };

  const [favNavIndex, setFavNavIndex] = useState(0);

  const scrollToNextFavorite = (e?: React.MouseEvent) => {
    e?.preventDefault();
    const favElements = document.querySelectorAll(".gallery-card.featured");
    if (!favElements.length) {
      const galleryEl = document.getElementById("gallery");
      if (galleryEl) {
        galleryEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setNotice("Chưa có khoảnh khắc nào được ghim Yêu thích ♡");
      return;
    }

    const nextIdx = favNavIndex % favElements.length;
    const targetEl = favElements[nextIdx] as HTMLElement;

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

      targetEl.classList.remove("fav-pulse-highlight");
      void targetEl.offsetWidth;
      targetEl.classList.add("fav-pulse-highlight");

      setFavNavIndex(nextIdx + 1);
      setNotice(`Chuyển đến khoảnh khắc yêu thích (${nextIdx + 1}/${favElements.length}) ♥`);
    }
  };

  return (
    <div className="app-shell">
      <div className="romance-backdrop" aria-hidden="true">
        <span className="romance-orb romance-orb-one" />
        <span className="romance-orb romance-orb-two" />
        <span className="floating-heart heart-one">♡</span>
        <span className="floating-heart heart-two">♡</span>
      </div>
      <RomanticEffects enabled={effectsEnabled} />
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,video/*,.heic,.heif,image/heic,image/heif,.mov,.m4v"
        multiple
        onChange={onFileChange}
      />

      <aside className="side-nav" aria-label="Điều hướng">
        <a className="brand-mark" href="#top" aria-label="Lặp Gallery">
          ♥
        </a>
        <button
          className="nav-icon active"
          type="button"
          aria-label="Chuyển đến khoảnh khắc yêu thích tiếp theo"
          onClick={scrollToNextFavorite}
        >
          ♡
        </button>
        <button
          className="nav-icon"
          type="button"
          aria-label="Mở thư viện ảnh và video"
          onClick={() => setManagerOpen((open) => !open)}
        >
          ✦
        </button>
        <button
          className="nav-icon add-icon"
          type="button"
          aria-label="Thêm ảnh hoặc video"
          onClick={() => fileInputRef.current?.click()}
        >
          +
        </button>
        <span className="nav-spacer" />
        <button
          className="nav-icon"
          type="button"
          aria-label="Đọc lại lá thư tình yêu"
          onClick={() => setIntroOpen(true)}
        >
          ✉
        </button>
        <button
          className="nav-icon"
          type="button"
          aria-label="Xáo trộn kỷ niệm"
          disabled={mediaItems.length < 2}
          onClick={shuffleMedia}
        >
          <Shuffle weight="bold" aria-hidden="true" style={{ width: "20px", height: "20px" }} />
        </button>
      </aside>

      <main
        id="top"
        className={`main-area${isDragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false);
        }}
        onDrop={onDrop}
      >
        <header className="top-bar">
          <div className="mobile-brand">
            <span className="brand-mark">♥</span>
            <span>Chuyện mình</span>
          </div>
          <button
            className="library-button"
            type="button"
            onClick={() => setManagerOpen((open) => !open)}
            aria-expanded={managerOpen}
          >
            <span aria-hidden="true">▤</span>
            Kỷ niệm
            <b>{mediaItems.length}</b>
          </button>
          <button
            className="shuffle-button"
            type="button"
            disabled={mediaItems.length < 2}
            onClick={shuffleMedia}
          >
            <Shuffle weight="bold" aria-hidden="true" />
            Xáo trộn
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={isAdding}
            onClick={() => fileInputRef.current?.click()}
          >
            <span aria-hidden="true">+</span>
            {isAdding ? "Đang thêm…" : "Thêm khoảnh khắc"}
          </button>
        </header>

        <section className="intro-row" aria-labelledby="page-title">
          <div className="intro-content">
            <button
              className="love-days-badge"
              type="button"
              onClick={() => setShowDateModal(true)}
              title="Nhấp để thay đổi ngày kỷ niệm"
              style={{ marginBottom: "10px" }}
            >
              <span aria-hidden="true">♥</span>
              <span>Bên nhau {loveDays} ngày</span>
            </button>
            <p className="eyebrow"><span aria-hidden="true">♥</span> NHẬT KÝ ẢNH &amp; VIDEO CỦA HAI ĐỨA</p>
            <AnimatedHeadline />
            <p className="intro-copy">
              Gom những tấm ảnh, đoạn video và nụ cười của hai đứa vào một thước phim dịu dàng. Đánh dấu <strong>Yêu thích</strong> để kỷ niệm ấy luôn nổi bật.
            </p>
            <div className="love-note">
              <span aria-hidden="true">♡</span>
              <p><strong>Riêng tư theo mặc định.</strong> Ảnh và video chỉ được lưu trên trình duyệt này.</p>
            </div>
          </div>
          <div className="count-control" aria-label="Số ô hiển thị">
            <div className="control-heading">
              <span>Nhịp lặp</span>
              <strong>{tileCount} khung</strong>
            </div>
            <div>
              {COUNT_OPTIONS.map((count) => (
                <button
                  type="button"
                  className={tileCount === count ? "selected" : ""}
                  key={count}
                  onClick={() => chooseCount(count)}
                  aria-pressed={tileCount === count}
                >
                  {count}
                </button>
              ))}
            </div>
            <p>Chọn độ dài cho thước phim khi bạn cuộn xuống.</p>
            <button
              className="effect-toggle"
              type="button"
              onClick={toggleEffects}
              aria-pressed={effectsEnabled}
            >
              <span aria-hidden="true">{effectsEnabled ? "♥" : "♡"}</span>
              {effectsEnabled ? "Hiệu ứng đang bật" : "Bật hiệu ứng"}
            </button>
          </div>
        </section>

        {(managerOpen || (!mediaItems.length && !isLoading)) && (
          <section className="library-panel" aria-label="Quản lý ảnh và video gốc">
            <div className="panel-heading">
              <div>
                <p className="eyebrow"><span aria-hidden="true">♡</span> GÓC KỶ NIỆM</p>
                <h2>{mediaItems.length ? `${mediaItems.length} khoảnh khắc của hai đứa` : "Đặt khoảnh khắc đầu tiên vào đây"}</h2>
              </div>
              {mediaItems.length > 0 && (
                <div className="panel-actions">
                  <button className="delete-all-button" type="button" onClick={() => setDeleteIntent({ kind: "all" })}>
                    <span aria-hidden="true">×</span>
                    Xóa tất cả
                  </button>
                  <button className="close-panel" type="button" onClick={() => setManagerOpen(false)}>
                    Đóng <span aria-hidden="true">×</span>
                  </button>
                </div>
              )}
            </div>

            {temporaryCount > 0 && (
              <div className="temporary-storage-note" role="status">
                <span aria-hidden="true">♡</span>
                <p>
                  <strong>{temporaryCount} khoảnh khắc đang được giữ trong phiên này.</strong>
                  Đừng tải lại hoặc đóng trang trước khi quay xong.
                </p>
              </div>
            )}

            {(uploadBatch || uploadTasks.length > 0) && (
              <div className="upload-progress-panel" role="status" aria-live="polite">
                <div className="upload-progress-heading">
                  <div>
                    <span>Đang nhập kỷ niệm</span>
                    <strong>{uploadDoneCount}/{uploadBatch?.total ?? uploadTasks.length} mục đã xử lý</strong>
                    <small>
                      {uploadActiveCount} đang chạy • {uploadQueuedCount} đang chờ • xong mục nào ẩn mục đó
                    </small>
                  </div>
                  {uploadErrorCount > 0 && <b>{uploadErrorCount} lỗi</b>}
                </div>
                {uploadTasks.length > 0 && (
                  <div className="upload-task-list">
                    {uploadTasks.map((task) => (
                      <article className={`upload-task is-${task.status}`} key={task.id}>
                        <span className="upload-task-icon" aria-hidden="true">
                          {task.kind === "video" ? (
                            <VideoCamera weight="duotone" />
                          ) : (
                            <ImageSquare weight="duotone" />
                          )}
                        </span>
                        <div className="upload-task-body">
                          <div className="upload-task-copy">
                            <strong title={task.fileName}>{task.fileName}</strong>
                            <span>{task.detail}</span>
                          </div>
                          <small>{task.title} • {task.fileSizeLabel}</small>
                          <div className="upload-task-bar" aria-hidden="true">
                            <i style={{ width: `${task.progress}%` }} />
                          </div>
                        </div>
                        <b>{task.progress}%</b>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!mediaItems.length ? (
              <button
                className="drop-zone"
                type="button"
                disabled={isAdding}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="upload-disc" aria-hidden="true">↑</span>
                <strong>Thả một khoảnh khắc vào đây</strong>
                <small>Không giới hạn cứng theo từng tệp • Tệp lớn có thể được giữ trong phiên hiện tại</small>
              </button>
            ) : (
              <div className="source-list">
                {mediaItems.map((media, index) => {
                  const sourceTitle = numberedMediaTitle(media, index);
                  return (
                    <article
                      className={`source-card${media.special ? " special" : ""}`}
                      key={media.id}
                      onContextMenu={(event) => openMediaMenu(event, media)}
                    >
                      {media.kind === "video" ? (
                        <video src={media.src} muted playsInline preload="metadata" aria-hidden="true" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={media.src} alt="" />
                      )}
                      <div className="source-info">
                        <div className="source-title">
                          {media.kind === "video" ? (
                            <VideoCamera weight="duotone" aria-hidden="true" />
                          ) : (
                            <ImageSquare weight="duotone" aria-hidden="true" />
                          )}
                          <strong>{sourceTitle}</strong>
                        </div>
                        <span>
                          {media.kind === "video" ? "VIDEO" : "ẢNH"} • {mediaDetails(media)}
                        </span>
                        {media.temporary && <span className="temporary-media-label">CHỈ TRONG PHIÊN NÀY</span>}
                      </div>
                      <button
                        className="special-toggle"
                        type="button"
                        role="switch"
                        aria-checked={media.special}
                        aria-label={media.special ? `Bỏ ghim ${sourceTitle}` : `Ghim ${sourceTitle}`}
                        onClick={() => void toggleSpecial(media.id)}
                      >
                        <span aria-hidden="true">★</span>
                        {media.special ? "Yêu thích" : "Ghim lại"}
                      </button>
                      <button
                        className="delete-button"
                        type="button"
                        onClick={() => setDeleteIntent({ kind: "single", media })}
                        aria-label={`Xóa ${sourceTitle}`}
                      >
                        ×
                      </button>
                    </article>
                  );
                })}
                <button className="add-source-card" type="button" disabled={isAdding} onClick={() => fileInputRef.current?.click()}>
                  <span aria-hidden="true">+</span>
                  {isAdding ? "Đang nhập" : "Thêm khoảnh khắc"}
                </button>
              </div>
            )}
          </section>
        )}

        {isLoading ? (
          <section className="loading-state" aria-live="polite">
            <span />
            <p>Đang mở thư viện của bạn…</p>
          </section>
        ) : mediaItems.length === 0 ? (
          <section className="empty-showcase" aria-label="Giới thiệu cách hoạt động">
            <div className="empty-visual" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/og-v2.png" alt="" />
              <span>GALLERY CỦA HAI ĐỨA</span>
            </div>
            <div className="empty-copy">
              <p className="empty-kicker">BẮT ĐẦU TỪ MỘT KHOẢNH KHẮC</p>
              <h2>Một chiếc trend nhỏ.<br /><em>Một câu chuyện rất riêng.</em></h2>
              <p>Chọn những khoảnh khắc của hai đứa, rồi cứ để chúng tự kể thành một câu chuyện. Mọi thứ chỉ được lưu trên máy này.</p>
              <ol className="mini-steps">
                <li><b>01</b><span>Thêm ảnh và video của hai đứa</span></li>
                <li><b>02</b><span>Ghim khoảnh khắc yêu thích</span></li>
                <li><b>03</b><span>Cuộn xuống và quay trend</span></li>
              </ol>
            </div>
          </section>
        ) : filteredMedia.length === 0 ? (
          <section className="no-results">
            <span aria-hidden="true">⌕</span>
            <h2>Không tìm thấy ảnh hoặc video “{query}”</h2>
            <button type="button" onClick={() => setQuery("")}>Xem toàn bộ thư viện</button>
          </section>
        ) : (
          <section id="gallery" className="gallery-section" aria-label="Bảng ảnh và video lặp">
            <div className="gallery-meta">
              <p>
                <span className="gallery-kicker">ĐANG LẶP</span>
                {filteredMedia.length} kỷ niệm đang tạo thành {repeatedFrameCount} khung hình
              </p>
              <p>{mediaItems.filter((media) => media.special).length} khoảnh khắc yêu thích</p>
            </div>
            <div className="masonry-grid">
              {feed.map(({ media, occurrence, key }) => (
                <div
                  className={`gallery-card${media.special ? " featured" : ""}`}
                  key={key}
                  role="button"
                  tabIndex={0}
                  aria-label={`Xem ${mediaKindTitle(media).toLocaleLowerCase("vi")}${media.special ? ", nội dung đặc biệt" : ""}`}
                  onClick={() => openCard(media)}
                  onContextMenu={(event) => openMediaMenu(event, media)}
                  onKeyDown={(event) => onCardKeyDown(event, media)}
                  style={cardGridStyle(media, occurrence)}
                >
                  {media.kind === "video" ? (
                    <AutoPreviewVideo src={media.src} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.src} alt="" loading="lazy" />
                  )}
                  {media.special && (
                    <span className="favorite-ribbon" aria-hidden="true">
                      <Heart weight="fill" />
                      YÊU THÍCH
                    </span>
                  )}
                  <button
                    className={`quick-star${media.special ? " active" : ""}`}
                    type="button"
                    aria-label={media.special ? "Bỏ đánh dấu khoảnh khắc này" : "Đánh dấu khoảnh khắc này là đặc biệt"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleSpecial(media.id);
                    }}
                  >
                    ♥
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {isDragging && (
          <div className="drop-overlay" aria-hidden="true">
            <span>↓</span>
            <strong>Thả khoảnh khắc của hai đứa vào đây</strong>
          </div>
        )}
      </main>

      {contextMenu && (
        <div
          className="media-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void toggleSpecial(contextMenu.media.id);
              setContextMenu(null);
            }}
          >
            <Star weight={contextMenu.media.special ? "fill" : "duotone"} aria-hidden="true" />
            {contextMenu.media.special ? "Bỏ yêu thích" : "Yêu thích"}
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              const mediaToDelete = contextMenu.media;
              setContextMenu(null);
              setDeleteIntent({ kind: "single", media: mediaToDelete });
            }}
          >
            <Trash weight="duotone" aria-hidden="true" />
            Xóa
          </button>
        </div>
      )}

      {preview && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Xem ${mediaKindTitle(preview).toLocaleLowerCase("vi")}`}>
          <button className="lightbox-close" type="button" onClick={() => setPreview(null)} aria-label="Đóng trình xem">
            ×
          </button>
          <div className="lightbox-image-wrap">
            {preview.kind === "video" ? (
              // User-provided clips do not have a separate caption track available.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={preview.src} controls autoPlay playsInline preload="metadata" aria-label={mediaKindTitle(preview)} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.src} alt={mediaKindTitle(preview)} />
            )}
          </div>
          <div className="lightbox-info">
            <div>
              <span>
                {preview.kind === "video"
                  ? (preview.special ? "VIDEO YÊU THÍCH" : "MỘT ĐOẠN KỶ NIỆM")
                  : (preview.special ? "ẢNH YÊU THÍCH" : "MỘT TẤM KỶ NIỆM")}
              </span>
              <h2>{mediaKindTitle(preview)}</h2>
              <p>{mediaDetails(preview)}</p>
            </div>
            <button type="button" onClick={() => void toggleSpecial(preview.id)}>
              <span aria-hidden="true">♥</span>
              {preview.special ? "Bỏ ghim" : "Ghim khoảnh khắc"}
            </button>
          </div>
        </div>
      )}

      {deleteIntent && (
        <div
          role="presentation"
          className="delete-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeleting) setDeleteIntent(null);
          }}
        >
          <section
            className="delete-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            aria-describedby="delete-confirm-description"
          >
            <span className="delete-confirm-icon" aria-hidden="true">♡</span>
            <p className="delete-confirm-eyebrow">XÁC NHẬN XÓA</p>
            <h2 id="delete-confirm-title">
              {deleteIntent.kind === "all"
                ? `Xóa toàn bộ ${mediaItems.length} khoảnh khắc?`
                : "Xóa khoảnh khắc này?"}
            </h2>
            <p id="delete-confirm-description">
              {deleteIntent.kind === "all"
                ? "Tất cả ảnh và video lưu trên trình duyệt này sẽ bị xóa. Hành động này không thể hoàn tác."
                : "Khoảnh khắc này sẽ bị xóa khỏi thư viện và bộ nhớ trên trình duyệt này."}
            </p>
            <div className="delete-confirm-actions">
              <button
                ref={deleteCancelButtonRef}
                className="dialog-button dialog-button-secondary"
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteIntent(null)}
              >
                Giữ lại
              </button>
              <button
                className="dialog-button dialog-button-danger"
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDeletion()}
              >
                {isDeleting
                  ? "Đang xóa…"
                  : deleteIntent.kind === "all" ? "Xóa tất cả" : "Xóa khoảnh khắc"}
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
      {introOpen && (
        <LoveLetterIntro
          loveDays={loveDays}
          onOpenDateModal={() => setShowDateModal(true)}
          onClose={() => setIntroOpen(false)}
        />
      )}
      {showDateModal && (
        <LoveDateModal
          currentDate={loveDateStr}
          onSave={(date) => {
            setLoveDateStr(date);
            localStorage.setItem("lap-gallery-love-date", date);
            void setSupabaseSetting("love_date", date);
          }}
          onClose={() => setShowDateModal(false)}
        />
      )}
    </div>
  );
}
