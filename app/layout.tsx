import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Pawly — AI Dog Monitor", template: "%s · Pawly" },
  description: "Turn any spare device into a private AI pet camera that understands the moments that matter.",
  openGraph: {
    title: "Pawly — See what happens after you leave.",
    description: "Turn any spare device into a private, dog-aware AI pet camera.",
    images: [{ url: "/og.png", width: 1728, height: 915, alt: "Pawly dog-aware room monitor" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pawly — See what happens after you leave.",
    description: "Turn any spare device into a private, dog-aware AI pet camera.",
    images: ["/og.png"],
  },
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
