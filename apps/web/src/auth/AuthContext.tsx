import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@mathsuivi/shared';
import { ApiError, api } from '../api/client';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Serveur injoignable au chargement : on ne sait pas si l'utilisateur est connecté. */
  unreachable: boolean;
  setMe(me: Me | null): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
      setUnreachable(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setUnreachable(false);
      } else {
        // Coupure ou redémarrage du serveur : ce n'est pas une déconnexion.
        setUnreachable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/deconnexion', 'POST').catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ me, loading, unreachable, setMe, refresh, logout }}>{children}</AuthContext.Provider>
  );
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
