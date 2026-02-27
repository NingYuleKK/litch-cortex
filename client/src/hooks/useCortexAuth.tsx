/**
 * Independent Cortex Auth Hook
 * 
 * Replaces Manus OAuth useAuth hook for production deployment.
 * Uses username/password + JWT cookie authentication.
 */
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface CortexUser {
  id: number;
  username: string;
  displayName: string | null;
  role: "admin" | "member";
  initialPassword?: string | null;
}

interface CortexAuthState {
  user: CortexUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  registerUser: (data: { username: string; password: string; displayName?: string; role?: string }) => Promise<void>;
  listUsers: () => Promise<CortexUser[]>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: number) => Promise<{ deletedProjects: number }>;
}

const CortexAuthContext = createContext<CortexAuthState | null>(null);

export function CortexAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CortexUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/cortex-auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        }
      } catch {
        // Not authenticated
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/cortex-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登录失败");
      }
      setUser(data);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/cortex-auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
    }
  }, []);

  const registerUser = useCallback(async (data: { username: string; password: string; displayName?: string; role?: string }) => {
    const res = await fetch("/api/cortex-auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "创建用户失败");
    }
    return result;
  }, []);

  const listUsers = useCallback(async () => {
    const res = await fetch("/api/cortex-auth/users", { credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "获取用户列表失败");
    return data;
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const res = await fetch("/api/cortex-auth/change-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "修改密码失败");
    }
  }, []);

  const deleteUser = useCallback(async (userId: number) => {
    const res = await fetch(`/api/cortex-auth/users/${userId}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "删除用户失败");
    }
    return data;
  }, []);

  return (
    <CortexAuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated: !!user,
        login,
        logout,
        registerUser,
        listUsers,
        changePassword,
        deleteUser,
      }}
    >
      {children}
    </CortexAuthContext.Provider>
  );
}

export function useCortexAuth() {
  const ctx = useContext(CortexAuthContext);
  if (!ctx) throw new Error("useCortexAuth must be used within CortexAuthProvider");
  return ctx;
}
