import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silences a Turbopack warning: a stray package-lock.json in a parent folder
  // (outside this repo) would otherwise make it guess the wrong workspace root.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // Vercel's default Cross-Origin-Opener-Policy (same-origin) blocks the
        // window.closed check Firebase's signInWithPopup relies on to detect
        // when the Google auth popup finishes - it throws auth/popup-blocked
        // even when the browser's own popup permission is granted (confirmed
        // live; a documented Firebase/Next.js issue, firebase-js-sdk #8541).
        // same-origin-allow-popups keeps the isolation but permits that check.
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
      },
    ];
  },
};

export default nextConfig;
