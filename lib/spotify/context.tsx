'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getStoredToken, logout as clearAuth } from './auth';

interface AuthContext {
  token: string | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthCtx = createContext<AuthContext>({ token: null, isLoading: true, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setToken(getStoredToken());
    setIsLoading(false);
  }, []);

  const logout = () => {
    clearAuth();
    setToken(null);
    window.location.href = '/';
  };

  return (
    <AuthCtx.Provider value={{ token, isLoading, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
