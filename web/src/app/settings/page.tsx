"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { getMe, uploadDefaultPaymentQr } from "@/lib/api";
import type { UserProfile } from "@/lib/types";

export default function SettingsPage() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [qrMethod, setQrMethod] = useState<"bank" | "tng">("bank");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      setProfile(await getMe(idToken));
    } catch (err) {
      // Without this, a failed fetch (cold backend, network hiccup) left the
      // page stuck on "Loading..." forever with zero feedback - confirmed live.
      setLoadError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, [getIdToken]);

  useEffect(() => {
    // Genuine data fetch tied to the signed-in user, not synchronously-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) refresh();
  }, [user, refresh]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not signed in");
      setProfile(await uploadDefaultPaymentQr(idToken, file, qrMethod));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload QR");
    } finally {
      setUploading(false);
    }
  }

  if (authLoading || !user) return null;

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <button onClick={refresh} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          Retry
        </button>
      </div>
    );
  }

  if (!profile) {
    return <p className="p-8 text-center text-slate-500 dark:text-slate-400">Loading…</p>;
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Default payment QR</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Saved here once, so you don&apos;t need to upload it again on every new bill.
        </p>

        {profile.default_payment_qr_image_url ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profile.default_payment_qr_image_url}
              alt="Default payment QR"
              className="h-40 w-40 rounded bg-white object-contain p-2"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {profile.default_payment_method_type === "tng" ? "Touch 'n Go" : "Bank transfer"}
            </p>
            <label className="text-xs text-slate-500 hover:underline cursor-pointer dark:text-slate-400">
              Replace
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={qrMethod}
              onChange={(e) => setQrMethod(e.target.value as "bank" | "tng")}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="bank">Bank transfer</option>
              <option value="tng">Touch &apos;n Go</option>
            </select>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              className="text-sm"
            />
          </div>
        )}

      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
