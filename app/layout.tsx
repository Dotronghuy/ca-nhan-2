import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Lặp | Chuyện chúng mình";
const description = "Gom ảnh và video của hai đứa thành một thước phim dịu dàng để quay trend cùng người mình yêu.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? requestHeaders.get("host")
    ?? "localhost:3001";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost") ? "http" : "https";
  const baseUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og-v2.png", baseUrl).toString();

  return {
    metadataBase: baseUrl,
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Một chút chúng mình, lặp lại thật lâu." }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
