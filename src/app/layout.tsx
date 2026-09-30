import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimList · 认领清单",
  description: "把事情列出来，大家领着做。供团队使用的轻量认领清单。",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
