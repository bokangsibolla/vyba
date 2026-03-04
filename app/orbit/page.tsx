'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { runDiscoveryEngine } from '@/lib/engine';
import { EngineState, DiscoveryOrbit } from '@/lib/engine/types';
import { sectionColors } from '@/lib/tokens';
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
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  const handleProgress = useCallback((state: EngineState) => {
    setEngineState(state);
    if (state.error) setError(state.error);
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
          return;
        }

        // Send first dig email with track links
        const email = localStorage.getItem('vyba_email');
        if (email) {
          const sections = orbits
            .filter((o) => o.status === 'ready' && o.tracks.length > 0)
            .map((o) => ({
              label: o.label,
              spotifyUrl: o.tracks[0]?.external_urls.spotify ?? '',
              trackCount: o.tracks.length,
              tracks: o.tracks.map((t) => ({
                name: t.name,
                artist: t.artists.map((a) => a.name).join(', '),
                url: t.external_urls.spotify,
              })),
            }));

          fetch('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((r) => r.json())
            .then((me) => {
              fetch('/api/send-dig', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email,
                  displayName: me.display_name || 'friend',
                  playlists: sections,
                }),
              });
            })
            .catch(() => {});
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
    return <DiscoveryLoading />;
  }

  const readyOrbits = engineState.orbits.filter((o) => o.status === 'ready' && o.tracks.length > 0);
  const totalTracks = readyOrbits.reduce((sum, o) => sum + o.tracks.length, 0);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={24} />
        <button className={styles.logoutBtn} onClick={() => { logout(); router.replace('/'); }}>
          Log out
        </button>
      </header>

      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>You&apos;re in.</h1>
        <p className={styles.heroSub}>
          {readyOrbits.length} sections, {totalTracks} tracks.
          Fresh ones every morning at 6am.
        </p>
      </div>

      <div className={styles.playlists}>
        {readyOrbits.map((orbit) => {
          const section = sectionColors[orbit.id as keyof typeof sectionColors];
          return (
            <div key={orbit.id} className={styles.playlistCard}>
              <div
                className={styles.playlistLabel}
                style={{ background: section?.bg, color: section?.accent }}
              >
                <span>{section?.label ?? orbit.label}</span>
                <span className={styles.trackCount}>{orbit.tracks.length} tracks</span>
              </div>
              <div className={styles.trackEmbeds}>
                {orbit.tracks.slice(0, 5).map((track) => (
                  <iframe
                    key={track.id}
                    src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`}
                    width="100%"
                    height="80"
                    frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    className={styles.embed}
                  />
                ))}
                {orbit.tracks.length > 5 && (
                  <p className={styles.moreText}>
                    + {orbit.tracks.length - 5} more in your email
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerText}>
          That&apos;s your first dig. Check your inbox tomorrow morning.
        </p>
      </footer>
    </main>
  );
}
