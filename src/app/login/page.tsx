"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import Image from "next/image";
import { AlertCircle, Loader2 } from "lucide-react";

/* ──────────────────────────────────────────────────────
   YouTube video IDs — warehouse / logistics / no-copyright
   Primary  : XK603-FIyaA  (Warehouse | Logistics | Free HD)
   Fallback : Scgs7-RtviU  (Massive Warehouse Timelapse)
   The iframe is oversized to hide YouTube UI chrome.
────────────────────────────────────────────────────── */
const YT_VIDEO_ID = "XK603-FIyaA";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(userId, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const ytSrc =
    `https://www.youtube.com/embed/${YT_VIDEO_ID}` +
    `?autoplay=1&mute=1&loop=1&playlist=${YT_VIDEO_ID}` +
    `&controls=0&rel=0&modestbranding=1&disablekb=1&fs=0&iv_load_policy=3&playsinline=1`;

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-slate-950">

      {/* ── YouTube background video ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <iframe
          src={ytSrc}
          title="background"
          allow="autoplay; encrypted-media"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            /* Cover viewport while keeping 16:9 ratio */
            width: "100vw",
            height: "56.25vw",   /* = 100vw × (9/16) */
            minWidth: "177.78vh", /* = 100vh × (16/9) */
            minHeight: "100vh",
            transform: "translate(-50%, -50%)",
            border: "none",
            pointerEvents: "none",
            opacity: 0.55,
          }}
        />
      </div>

      {/* ── Gradient overlay ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/85 via-slate-900/65 to-blue-950/75 pointer-events-none" />

      {/* ── Subtle dot-grid texture ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* ── Login panel ── */}
      <div className="relative z-10 w-full max-w-sm">

        {/* Logo + tagline */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-3 drop-shadow-2xl">
            <Image
              src="/stl-logo.png"
              alt="STL Logo"
              width={130}
              height={52}
              className="object-contain"
              priority
            />
          </div>
          <p className="text-slate-400 text-sm tracking-wide">Spider WMS · Operations Dashboard</p>
        </div>

        {/* Glassmorphism card */}
        <div
          className="rounded-2xl shadow-2xl p-8 space-y-5"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="mb-1">
            <h2 className="text-white font-semibold text-lg tracking-tight">Sign in</h2>
            <p className="text-slate-400 text-xs mt-0.5">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase tracking-wide">
                User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                autoFocus
                placeholder="Enter your user ID"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-300 bg-red-900/40 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40 mt-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-600 text-xs mt-6">
          © {new Date().getFullYear()} Spider Logistics · Powered by STL
        </p>
      </div>
    </div>
  );
}
