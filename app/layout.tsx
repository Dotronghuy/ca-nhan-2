import type { Metadata } from "next";
import "./globals.css";

const title = "Lặp | Chuyện chúng mình";
const description = "Gom ảnh và video của hai đứa thành một thước phim dịu dàng để quay trend cùng người mình yêu.";

export const metadata: Metadata = {
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
    images: [{ url: "/og-v2.png", width: 1536, height: 1024, alt: "Một chút chúng mình, lặp lại thật lâu." }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-v2.png"],
  },
};

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
