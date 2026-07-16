import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default "bottom-left" sits directly under PrimaryNavigation's mobile bottom
  // bar (its leftmost item, Home) and intercepts clicks on it in dev mode — see
  // docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md. Dev-only; irrelevant in prod.
  devIndicators: {
    position: "top-right",
  },
};

export default nextConfig;
