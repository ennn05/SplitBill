"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Client components are still module-evaluated once during Next.js's server-side
// prerender pass, where `window` doesn't exist and real Firebase env vars aren't
// injected - the Firebase SDK throws immediately on an invalid/missing API key.
// Real initialization only needs to happen once this module re-evaluates in the
// browser bundle, so skip it entirely on the server.
const isBrowser = typeof window !== "undefined";

export const firebaseApp: FirebaseApp | null = isBrowser
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;
export const auth: Auth = isBrowser ? getAuth(firebaseApp!) : (null as unknown as Auth);
export const googleProvider = new GoogleAuthProvider();
