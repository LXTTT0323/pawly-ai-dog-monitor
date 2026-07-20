import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pawly Coach",
    short_name: "Pawly",
    description: "Turn an old iPad into your puppy's first AI coach.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f2e9",
    theme_color: "#173f35",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
