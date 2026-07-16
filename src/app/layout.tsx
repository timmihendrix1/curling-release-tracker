import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curling Release Tracker",
  description:
    "Track and analyze curling release consistency.",

  manifest: "/manifest.json",

  icons: {
    apple: "/icon.png",
    icon: "/icon.png",
  },
};

// viewport-fit=cover lets env(safe-area-inset-*) resolve to the actual iOS
// safe-area insets instead of 0 — required for PrimaryNavigation's bottom
// safe-area padding to have any effect on notch/Home-Indicator devices.
// themeColor moved here from `metadata` (Next.js 14+ requires it in the
// viewport export, not metadata).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
