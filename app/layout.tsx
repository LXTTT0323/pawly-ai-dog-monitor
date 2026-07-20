import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pawly Coach", template: "%s · Pawly Coach" },
  description: "Turn an old iPad into your puppy's first AI coach.",
};

export const viewport: Viewport = {
  themeColor: "#173f35",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
