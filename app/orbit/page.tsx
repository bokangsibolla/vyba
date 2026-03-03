'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { runDiscoveryEngine } from '@/lib/engine';
import { DiscoveryOrbit, EngineState } from '@/lib/engine/types';
import OrbitMap from '@/components/OrbitMap';
import OrbitDetail from '@/components/OrbitDetail';
import DiscoveryLoading from '@/components/DiscoveryLoading';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function OrbitPage() {
  const router = useRouter();
  const [engineState, setEngineState] = useState<EngineState>({
    orbits: [],
    isLoading: true,
    progress: [],
  });
  const [selectedOrbit, setSelectedOrbit] = useState<DiscoveryOrbit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  const handleProgress = useCallback((state: EngineState) => {
    setEngineState(state);
    if (state.error) {
      setError(state.error);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    const token = getStoredToken();
    if (!token) {
      router.replace('/');
      return;
    }

    runDiscoveryEngine(token, handleProgress)
      .then((orbits) => {
        if (orbits.length === 0) {
          setError('No listening data found. Listen to more music on Spotify and try again.');
        }
      })
      .catch((e) => {
        setError(e.message || 'Failed to load your music data');
      });
  }, [router, handleProgress]);

  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <Logo size={28} />
          <p className={styles.errorTitle}>Something went wrong</p>
          <p className={styles.errorMessage}>{error}</p>
          <div className={styles.errorActions}>
            <button
              className={styles.retryBtn}
              onClick={() => {
                fetched.current = false;
                setError(null);
                setEngineState({ orbits: [], isLoading: true, progress: [] });
              }}
            >
              Retry
            </button>
            <button
              className={styles.logoutBtnAlt}
              onClick={() => { logout(); router.replace('/'); }}
            >
              Log out
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (engineState.isLoading) {
    return <DiscoveryLoading progress={engineState.progress} />;
  }

  if (selectedOrbit) {
    return (
      <main className={styles.main}>
        <OrbitDetail orbit={selectedOrbit} onBack={() => setSelectedOrbit(null)} />
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={28} />
        <p className={styles.subtitle}>your orbit map</p>
        <div className={styles.headerRight}>
          <button className={styles.logoutBtn} onClick={() => { logout(); router.replace('/'); }}>Log out</button>
        </div>
      </header>
      <OrbitMap orbits={engineState.orbits} onSelectOrbit={setSelectedOrbit} />
      <footer className={styles.footer}>
        <p className={styles.footerText}>vyba.vercel.app</p>
      </footer>
    </main>
  );
}
