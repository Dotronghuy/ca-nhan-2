"use client";

import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
};

type StoredGalleryMedia = Omit<GalleryMedia, "kind" | "mimeType" | "src"> & {
  kind?: MediaKind;
  mimeType?: string;
};

const DB_NAME = "lap-gallery";
const STORE_NAME = "images";
const COUNT_OPTIONS = [24, 42, 72, 108];
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;
const VIDEO_PREVIEW_DURATION_MS = 4_000;

let stopActiveVideoPreview: (() => void) | null = null;

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(m4v|mov|mp4|ogv|webm)$/i.test(file.name);
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
    const { src: _src, ...storedMedia } = media;
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

async function prepareImage(file: File): Promise<GalleryMedia> {
  const bitmap = await createImageBitmap(file);
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

  const dataUrl = canvas.toDataURL("image/webp", 0.88);

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

async function prepareVideo(file: File): Promise<GalleryMedia> {
  const src = URL.createObjectURL(file);

  try {
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

function rowSpanFor(media: GalleryMedia, occurrence: number) {
  const ratio = media.height / media.width;
  const variation = (occurrence % 3) - 1;
  if (media.special) {
    return Math.max(18, Math.min(27, Math.round(17 + ratio * 4 + variation)));
  }
  return Math.max(11, Math.min(23, Math.round(8 + ratio * 6 + variation)));
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

    let previewTimeout: number | undefined;
    let playRequested = false;

    const stopPreview = () => {
      playRequested = false;
      if (previewTimeout !== undefined) {
        window.clearTimeout(previewTimeout);
        previewTimeout = undefined;
      }
      video.pause();
      if (video.readyState > 0) video.currentTime = 0;
      setIsPlaying(false);
      if (stopActiveVideoPreview === stopPreview) {
        stopActiveVideoPreview = null;
      }
    };

    const startPreview = () => {
      if (stopActiveVideoPreview === stopPreview) return;

      stopActiveVideoPreview?.();
      stopActiveVideoPreview = stopPreview;
      playRequested = true;
      if (video.readyState > 0) video.currentTime = 0;
      video.muted = true;

      void video.play()
        .then(() => {
          if (!playRequested || stopActiveVideoPreview !== stopPreview) {
            video.pause();
            return;
          }
          setIsPlaying(true);
          previewTimeout = window.setTimeout(
            stopPreview,
            VIDEO_PREVIEW_DURATION_MS,
          );
        })
        .catch(stopPreview);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          startPreview();
        } else if (stopActiveVideoPreview === stopPreview) {
          stopPreview();
        }
      },
      { threshold: [0, 0.65, 1], rootMargin: "0px 0px -8% 0px" },
    );

    video.addEventListener("ended", stopPreview);
    observer.observe(video);

    return () => {
      observer.disconnect();
      video.removeEventListener("ended", stopPreview);
      if (stopActiveVideoPreview === stopPreview) stopPreview();
    };
  }, [src]);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
      <span className={`video-badge${isPlaying ? " is-playing" : ""}`}>
        {isPlaying ? "● ĐANG PHÁT" : "▶ VIDEO"}
      </span>
    </>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<GalleryMedia[]>([]);
  const [mediaItems, setMediaItems] = useState<GalleryMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tileCount, setTileCount] = useState(42);
  const [preview, setPreview] = useState<GalleryMedia | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let disposed = false;
    const storedCount = Number(localStorage.getItem("lap-gallery-count"));
    if (COUNT_OPTIONS.includes(storedCount)) setTileCount(storedCount);

    readMedia()
      .then((items) => {
        if (disposed) {
          items.forEach((item) => {
            if (item.kind === "video") URL.revokeObjectURL(item.src);
          });
          return;
        }
        setMediaItems(items);
      })
      .catch(() => setNotice("Không thể đọc thư viện cũ, bạn vẫn có thể thêm nội dung mới."))
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    mediaRef.current = mediaItems;
  }, [mediaItems]);

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
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const filteredMedia = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    if (!normalizedQuery) return mediaItems;
    return mediaItems.filter((media) =>
      media.name.toLocaleLowerCase("vi").includes(normalizedQuery),
    );
  }, [mediaItems, query]);

  const feed = useMemo(() => {
    if (!filteredMedia.length) return [];
    return Array.from({ length: tileCount }, (_, index) => {
      const media = filteredMedia[index % filteredMedia.length];
      return {
        media,
        occurrence: Math.floor(index / filteredMedia.length),
        key: `${media.id}-${index}`,
      };
    });
  }, [filteredMedia, tileCount]);

  const addFiles = async (files: File[]) => {
    const validFiles = files.filter((file) =>
      (isImageFile(file) && file.size <= MAX_IMAGE_SIZE)
      || (isVideoFile(file) && file.size <= MAX_VIDEO_SIZE),
    );
    if (!validFiles.length) {
      setNotice("Chọn ảnh dưới 25 MB hoặc video MP4, WebM, MOV dưới 200 MB.");
      return;
    }

    setIsAdding(true);
    const added: GalleryMedia[] = [];
    let failed = files.length - validFiles.length;

    for (const file of validFiles) {
      let prepared: GalleryMedia | undefined;
      try {
        prepared = isVideoFile(file)
          ? await prepareVideo(file)
          : await prepareImage(file);
        await saveMedia(prepared);
        added.push(prepared);
      } catch {
        if (prepared?.kind === "video") URL.revokeObjectURL(prepared.src);
        failed += 1;
      }
    }

    setMediaItems((current) => [...current, ...added]);
    setManagerOpen(true);
    setIsAdding(false);
    if (failed) {
      setNotice(`Đã thêm ${added.length} mục, ${failed} tệp không đọc được hoặc quá dung lượng.`);
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
    const updated = { ...current, special: !current.special };
    setMediaItems((items) =>
      items.map((media) => (media.id === id ? updated : media)),
    );
    setPreview((currentPreview) =>
      currentPreview?.id === id ? updated : currentPreview,
    );
    try {
      await saveMedia(updated);
      setNotice(
        updated.special
          ? `“${updated.name}” đã thành nội dung đặc biệt.`
          : `“${updated.name}” đã trở về ô thường.`,
      );
    } catch {
      setNotice("Thay đổi đã áp dụng nhưng chưa thể lưu cho lần mở sau.");
    }
  };

  const deleteOne = async (media: GalleryMedia) => {
    if (!window.confirm(`Xóa “${media.name}” khỏi thư viện?`)) return;
    setPreview((current) => current?.id === media.id ? null : current);
    setMediaItems((items) => items.filter((item) => item.id !== media.id));
    if (media.kind === "video") URL.revokeObjectURL(media.src);
    try {
      await removeMedia(media.id);
      setNotice(`Đã xóa “${media.name}”.`);
    } catch {
      setNotice("Nội dung đã ẩn nhưng chưa thể xóa khỏi bộ nhớ trình duyệt.");
    }
  };

  const chooseCount = (count: number) => {
    setTileCount(count);
    localStorage.setItem("lap-gallery-count", String(count));
  };

  const openCard = (media: GalleryMedia) => {
    stopActiveVideoPreview?.();
    setPreview(media);
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

  return (
    <div className="app-shell">
      <div className="romance-backdrop" aria-hidden="true">
        <span className="romance-orb romance-orb-one" />
        <span className="romance-orb romance-orb-two" />
        <span className="floating-heart heart-one">♡</span>
        <span className="floating-heart heart-two">♡</span>
      </div>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,video/*,.mov,.m4v"
        multiple
        onChange={onFileChange}
      />

      <aside className="side-nav" aria-label="Điều hướng">
        <a className="brand-mark" href="#top" aria-label="Lặp Gallery">
          ♥
        </a>
        <a className="nav-icon active" href="#gallery" aria-label="Bảng ảnh và video">
          ♡
        </a>
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
          aria-label="Cách sử dụng"
          onClick={() => setNotice("Thêm ảnh hoặc video → tích dấu sao → chọn số ô. Nội dung sẽ tự lặp lại.")}
        >
          ?
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
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm một kỷ niệm…"
              aria-label="Tìm theo tên ảnh hoặc video"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">
                ×
              </button>
            )}
          </label>
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
            <p className="eyebrow"><span aria-hidden="true">♥</span> NHẬT KÝ ẢNH &amp; VIDEO CỦA HAI ĐỨA</p>
            <h1 id="page-title">
              Gom từng khoảnh khắc,<br />
              <em>giữ cả chuyện chúng mình.</em>
            </h1>
            <p className="intro-copy">
              Gom những tấm ảnh, đoạn video và nụ cười của hai đứa vào một thước phim dịu dàng. Đánh dấu <strong>Yêu thích</strong> để kỷ niệm ấy luôn nổi bật.
            </p>
            <div className="love-note">
              <span aria-hidden="true">∞</span>
              <p>Mỗi lần cuộn là một lần mình gặp lại nhau.</p>
            </div>
          </div>
          <div className="count-control" aria-label="Số ô hiển thị">
            <span>Nhịp lặp</span>
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
                <button className="close-panel" type="button" onClick={() => setManagerOpen(false)}>
                  Đóng <span aria-hidden="true">×</span>
                </button>
              )}
            </div>

            {!mediaItems.length ? (
              <button
                className="drop-zone"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="upload-disc" aria-hidden="true">↑</span>
                <strong>Thả một khoảnh khắc vào đây</strong>
                <small>Ảnh tối đa 25 MB • Video MP4, WebM, MOV tối đa 200 MB</small>
              </button>
            ) : (
              <div className="source-list">
                {mediaItems.map((media) => (
                  <article className={`source-card${media.special ? " special" : ""}`} key={media.id}>
                    {media.kind === "video" ? (
                      <video src={media.src} muted playsInline preload="metadata" aria-hidden="true" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={media.src} alt="" />
                    )}
                    <div className="source-info">
                      <strong title={media.name}>{media.name}</strong>
                      <span>
                        {media.kind === "video" ? `VIDEO • ${formatDuration(media.duration)} • ` : "ẢNH • "}
                        {media.width} × {media.height}
                      </span>
                    </div>
                    <button
                      className="special-toggle"
                      type="button"
                      role="switch"
                      aria-checked={media.special}
                      onClick={() => void toggleSpecial(media.id)}
                    >
                      <span aria-hidden="true">★</span>
                      {media.special ? "Yêu thích" : "Ghim lại"}
                    </button>
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => void deleteOne(media)}
                      aria-label={`Xóa ${media.name}`}
                    >
                      ×
                    </button>
                  </article>
                ))}
                <button className="add-source-card" type="button" onClick={() => fileInputRef.current?.click()}>
                  <span aria-hidden="true">+</span>
                  Thêm khoảnh khắc
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
            <div className="empty-grid" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => (
                <span className={`demo-tile demo-${index + 1}`} key={index} />
              ))}
            </div>
            <div className="empty-copy">
              <span className="step-number">♥</span>
              <p className="handwritten">made for your favorite person</p>
              <h2>Một chiếc trend nhỏ.<br /><em>Một tình yêu thật to.</em></h2>
              <p>Chọn những khoảnh khắc của hai đứa, rồi cứ để chúng tự kể thành một câu chuyện. Mọi thứ chỉ được lưu trên máy này.</p>
              <div className="mini-steps">
                <span><b>1</b> Thêm ảnh và video của hai đứa</span>
                <span><b>2</b> Ghim khoảnh khắc yêu thích</span>
                <span><b>3</b> Cuộn xuống và quay trend</span>
              </div>
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
                <span className="live-dot" />
                {filteredMedia.length} kỷ niệm đang tạo thành {tileCount} khung hình
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
                  aria-label={`Xem ${media.kind === "video" ? "video" : "ảnh"} ${media.name}${media.special ? ", nội dung đặc biệt" : ""}`}
                  onClick={() => openCard(media)}
                  onKeyDown={(event) => onCardKeyDown(event, media)}
                  style={{
                    gridColumn: media.special ? "span 2" : "span 1",
                    gridRow: `span ${rowSpanFor(media, occurrence)}`,
                  }}
                >
                  {media.kind === "video" ? (
                    <AutoPreviewVideo src={media.src} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.src} alt={media.name} loading="lazy" />
                  )}
                  <div className="card-shade" />
                  <div className="card-label">
                    {media.special && <span>YÊU THÍCH</span>}
                    <strong>{media.name}</strong>
                  </div>
                  <button
                    className={`quick-star${media.special ? " active" : ""}`}
                    type="button"
                    aria-label={media.special ? `Bỏ đánh dấu ${media.name}` : `Đánh dấu ${media.name} là đặc biệt`}
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

      {preview && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Xem ${preview.kind === "video" ? "video" : "ảnh"} ${preview.name}`}>
          <button className="lightbox-close" type="button" onClick={() => setPreview(null)} aria-label="Đóng trình xem">
            ×
          </button>
          <div className="lightbox-image-wrap">
            {preview.kind === "video" ? (
              <video src={preview.src} controls autoPlay playsInline preload="metadata" aria-label={preview.name} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.src} alt={preview.name} />
            )}
          </div>
          <div className="lightbox-info">
            <div>
              <span>
                {preview.kind === "video"
                  ? (preview.special ? "VIDEO YÊU THÍCH" : "MỘT ĐOẠN KỶ NIỆM")
                  : (preview.special ? "ẢNH YÊU THÍCH" : "MỘT TẤM KỶ NIỆM")}
              </span>
              <h2>{preview.name}</h2>
            </div>
            <button type="button" onClick={() => void toggleSpecial(preview.id)}>
              <span aria-hidden="true">♥</span>
              {preview.special ? "Bỏ ghim" : "Ghim khoảnh khắc"}
            </button>
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
