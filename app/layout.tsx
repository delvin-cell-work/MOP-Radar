import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/SiteFooter";

import "./globals.css";

export const metadata: Metadata = {
  title: "MOP Radar · HDB blocks passing their MOP",
  description:
    "See which HDB blocks recently passed, or are about to pass, their 5-year Minimum Occupation Period, across Singapore.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-SG" className="h-full">
      <body className="h-full overflow-hidden bg-white font-sans text-slate-900 antialiased">
        <div className="fixed inset-0 flex flex-col">
          <div className="relative min-h-0 flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
