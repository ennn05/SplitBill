import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silences a Turbopack warning: a stray package-lock.json in a parent folder
  // (outside this repo) would otherwise make it guess the wrong workspace root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
