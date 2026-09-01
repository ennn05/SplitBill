"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  getIdToken: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    getIdToken: () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null)),
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    signUp: async (email, password) => {
      await createUserWithEmailAndPassword(auth, email, password);
    },
    signInWithGoogle: async () => {
      // No signInWithRedirect fallback here: Firebase's authDomain
      // (splitbill-181f1.firebaseapp.com) is a different domain than the app
      // (Vercel), which makes signInWithRedirect silently fail with no error
      // in browsers that block third-party storage access - a documented
      // Firebase issue (firebase-js-sdk #7824), confirmed live in this app.
      // The supported fix short of a reverse-proxy setup is to stick with
      // the popup and surface a clear error if it's blocked, since
      // email/password sign-in already covers that case reliably.
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        if (err instanceof FirebaseError && err.code === "auth/popup-blocked") {
          throw new Error("Your browser blocked the Google sign-in popup. Please allow popups for this site, or sign in with email/password instead.");
        }
        throw err;
      }
    },
    signOut: () => firebaseSignOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
