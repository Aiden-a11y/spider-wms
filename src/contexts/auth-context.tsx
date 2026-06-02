"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { WMS_BASE } from "@/lib/wms";

interface AuthUser {
  userId: string;
  token: string;
  name?: string;
  level?: string;   // "Manager" | "Admin" | "Staff" | ...
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = sessionStorage.getItem("wms_auth");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {}
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    const res = await fetch(`${WMS_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, password, clientId: "wms_web" }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.message ?? `Login failed (${res.status})`);
    }

    const json = await res.json();
    // 🔍 TEMP: log full login response to inspect level field name
    console.log("[AUTH] login response:", JSON.stringify(json, null, 2));
    // Support common token response shapes
    const token =
      json?.data?.token ??
      json?.data?.accessToken ??
      json?.token ??
      json?.accessToken;

    if (!token) throw new Error("Token not found in response");

    const name = json?.data?.name ?? json?.data?.userName ?? userId;
    // Try common field names for user level/role
    const level =
      json?.data?.level ??
      json?.data?.userLevel ??
      json?.data?.memberLevel ??
      json?.data?.role ??
      json?.data?.authority ??
      json?.level ??
      undefined;
    const authUser: AuthUser = { userId, token, name, level };

    sessionStorage.setItem("wms_auth", JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("wms_auth");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
