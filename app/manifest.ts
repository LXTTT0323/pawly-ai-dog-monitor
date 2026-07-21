import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pawly Coach",
    short_name: "Pawly",
    description: "Turn any spare device into a private AI pet camera that understands the moments that matter.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f2e9",
    theme_color: "#173f35",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
