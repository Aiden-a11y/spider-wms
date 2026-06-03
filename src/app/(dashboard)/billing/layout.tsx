"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Receipt, SlidersHorizontal, Lock, Eye, EyeOff } from "lucide-react";

const TABS = [
  { href: "/billing",       label: "Invoices",     icon: Receipt },
  { href: "/billing/rates", label: "Rate Master",  icon: SlidersHorizontal },
];

const BILLING_PW = "2020";
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!unlocked) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [unlocked]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === BILLING_PW) {
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 500);
      inputRef.current?.focus();
    }
  }

  if (!unlocked) {
    return (
      <div className="flex items-center justify-center min-h-full bg-slate-50">
        <style>{`
          @keyframes shake {
            0%,100%{transform:translateX(0)}
            20%,60%{transform:translateX(-6px)}
            40%,80%{transform:translateX(6px)}
          }
          .shake { animation: shake 0.4s ease; }
        `}</style>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-10 w-full max-w-sm text-center">
          {/* Lock icon */}
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock className="w-8 h-8 text-blue-600" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 mb-1">Billing Access</h2>
          <p className="text-sm text-slate-500 mb-8">Enter the password to access billing.</p>

          <form onSubmit={handleSubmit}>
            <div className={`relative mb-3 ${shake ? "shake" : ""}`}>
              <input
                ref={inputRef}
                type={showPw ? "text" : "password"}
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(false); }}
                placeholder="Password"
                className={`w-full px-4 py-3 pr-11 rounded-xl border text-sm font-medium outline-none transition-all
                  ${error
                    ? "border-red-400 bg-red-50 text-red-700 placeholder-red-300 focus:ring-2 focus:ring-red-200"
                    : "border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  }`}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-500 mb-3 font-medium">Incorrect password. Try again.</p>
            )}

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-8">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/billing"
                ? pathname === "/billing"
                : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
