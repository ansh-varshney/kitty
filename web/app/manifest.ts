import type { MetadataRoute } from "next";

/** Installable as an app (FR-UX-8): its own window, no address bar. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kitty",
    short_name: "Kitty",
    description: "Plan, pay and save with friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf5ea",
    theme_color: "#cbebdb",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
