import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@mathsuivi/shared';
import { ApiError, api } from '../api/client';

interface AuthState {
  me: Me | null;
  loading: boolean;
  setMe(me: Me | null): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/deconnexion', 'POST').catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  return <AuthContext.Provider value={{ me, loading, setMe, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}

export function homePath(me: Me | null) {
  if (!me) return '/';
  if (me.role === 'apprenti') return me.doitChangerPin ? '/apprenti/code' : '/apprenti';
  return '/formateur';
}
