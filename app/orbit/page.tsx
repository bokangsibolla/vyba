'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { getDeezerToken } from '@/lib/deezer/auth';
import { createMusicService, MusicService } from '@/lib/music';
import { runDiscoveryEngine } from '@/lib/engine';
import { EngineState, DiscoveryOrbit } from '@/lib/engine/types';
import { sectionColors, sectionMeta, SectionId } from '@/lib/tokens';
import DiscoveryLoading from '@/components/DiscoveryLoading';
import Logo from '@/components/Logo';
import styles from './page.module.css';

interface SavedPlaylist {
  orbitId: string;
  label: string;
  playlistId: string;
  url: string;
  trackCount: number;
  tracks: { name: string; artist: string; url: string }[];
  service: 'spotify' | 'deezer';
}

function getEmbedSrc(pl: SavedPlaylist): string {
  if (pl.service === 'deezer') {
    return `https://widget.deezer.com/widget/dark/playlist/${pl.playlistId}`;
  }
  return `https://open.spotify.com/embed/playlist/${pl.playlistId}?utm_source=generator&theme=0`;
}

function resolveService(): { service: 'spotify' | 'deezer'; token: string } | null {
  const spotifyToken = getStoredToken();
  if (spotifyToken) return { service: 'spotify', token: spotifyToken };

  const deezerToken = getDeezerToken();
  if (deezerToken) return { service: 'deezer', token: deezerToken };

  return null;
}

export default function OrbitPage() {
  const router = useRouter();
  const [engineState, setEngineState] = useState<EngineState>({
    orbits: [],
    isLoading: true,
    progress: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [phase, setPhase] = useState<'loading' | 'saving' | 'done'>('loading');
  const fetched = useRef(false);
  const musicServiceRef = useRef<MusicService | null>(null);

  const handleProgress = useCallback((state: EngineState) => {
    setEngineState(state);
    if (state.error) setError(state.error);
  }, []);

  // Step 1: Run discovery
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    const resolved = resolveService();
    if (!resolved) {
      router.replace('/');
      return;
    }

    const ms = createMusicService(resolved.service, resolved.token);
    musicServiceRef.current = ms;
    localStorage.setItem('vyba_service', resolved.service);

    runDiscoveryEngine(ms, handleProgress)
      .then((orbits) => {
        if (orbits.length === 0) {
          setError('No listening data found. Listen to more music and try again.');
        }
      })
      .catch((e) => {
        setError(e.message || 'Failed to load your music data');
      });
  }, [router, handleProgress]);

  // Step 2: Auto-create playlists when discovery completes
  useEffect(() => {
    if (engineState.isLoading || phase !== 'loading') return;
    const readyOrbits = engineState.orbits.filter((o) => o.status === 'ready' && o.tracks.length > 0);
    if (readyOrbits.length === 0) return;

    const ms = musicServiceRef.current;
    if (!ms) return;

    setPhase('saving');

    async function saveAll(orbits: DiscoveryOrbit[], musicSvc: MusicService) {
      const saved: SavedPlaylist[] = [];
      const errors: string[] = [];

      for (const orbit of orbits) {
        try {
          const url = await musicSvc.createPlaylist(
            `${orbit.label} · vyba`,
            orbit.description,
            orbit.tracks.map((t) => t.uri)
          );

          // Extract playlist ID from URL
          let playlistId = '';
          if (musicSvc.service === 'deezer') {
            playlistId = url.split('/playlist/')[1] ?? '';
          } else {
            playlistId = url.split('/playlist/')[1]?.split('?')[0] ?? '';
          }

          saved.push({
            orbitId: orbit.id,
            label: orbit.label,
            playlistId,
            url,
            trackCount: orbit.tracks.length,
            tracks: orbit.tracks.map((t) => ({
              name: t.name,
              artist: t.artist,
              url: t.externalUrl,
            })),
            service: musicSvc.service,
          });
        } catch (e) {
          errors.push(`${orbit.label}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }

      if (saved.length === 0 && errors.length > 0) {
        const is403 = errors.some(e => e.includes('403'));
        const hint = is403 ? ' Try logging out and back in to grant playlist permissions.' : '';
        setError(`Could not create playlists. ${errors[0]}${hint}`);
        return;
      }

      setPlaylists(saved);
      setPhase('done');

      // Send first dig email (only once)
      const email = localStorage.getItem('vyba_email');
      const alreadySent = localStorage.getItem('vyba_first_dig_sent');
      if (email && saved.length > 0 && !alreadySent) {
        try {
          let displayName = 'friend';

          if (musicSvc.service === 'spotify') {
            const resolved = resolveService();
            if (resolved) {
              const me = await fetch('https://api.spotify.com/v1/me', {
                headers: { Authorization: `Bearer ${resolved.token}` },
              }).then((r) => r.json());
              displayName = me.display_name || 'friend';
            }
          }

          const res = await fetch('/api/send-dig', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              displayName,
              playlists: saved.map((p) => ({
                label: p.label,
                spotifyUrl: p.url,
                trackCount: p.trackCount,
                tracks: p.tracks,
              })),
            }),
          });
          if (res.ok) {
            localStorage.setItem('vyba_first_dig_sent', 'true');
          }
        } catch {
          // Email send is non-blocking
        }
      }
    }

    saveAll(readyOrbits, ms);
  }, [engineState.isLoading, engineState.orbits, phase]);

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
                setPhase('loading');
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

  if (phase !== 'done') {
    return <DiscoveryLoading />;
  }

  const totalTracks = playlists.reduce((sum, p) => sum + p.trackCount, 0);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={24} />
        <div className={styles.headerLinks}>
          <button className={styles.logoutBtn} onClick={() => router.push('/account')}>
            Account
          </button>
          <button className={styles.logoutBtn} onClick={() => { logout(); router.replace('/'); }}>
            Log out
          </button>
        </div>
      </header>

      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>You&apos;re in.</h1>
        <p className={styles.heroSub}>
          {playlists.length} playlists built from your listening history.
          New ones land in your inbox every morning at 6am.
        </p>
        <p className={styles.heroExplainer}>
          Each playlist digs into a different side of your taste — from your roots to music you&apos;ve never heard.
        </p>
        <p className={styles.spamNotice}>
          Check your spam folder for an email from VYBA.
        </p>
      </div>

      <div className={styles.playlists}>
        {playlists.map((pl) => {
          const section = sectionColors[pl.orbitId as keyof typeof sectionColors];
          return (
            <div key={pl.orbitId} className={styles.playlistCard}>
              <div
                className={styles.playlistLabel}
                style={{ background: section?.bg, color: section?.accent }}
              >
                <div className={styles.playlistLabelTop}>
                  <span>{section?.label ?? pl.label}</span>
                  <span className={styles.trackCount}>{pl.trackCount} tracks</span>
                </div>
                {sectionMeta[pl.orbitId as SectionId] && (
                  <span className={styles.playlistTagline}>
                    {sectionMeta[pl.orbitId as SectionId].tagline}
                  </span>
                )}
              </div>
              <iframe
                src={getEmbedSrc(pl)}
                width="100%"
                height="352"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                className={styles.embed}
              />
              <a
                href={pl.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.openLink}
              >
                Open in {pl.service === 'deezer' ? 'Deezer' : 'Spotify'}
              </a>
            </div>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerText}>
          That&apos;s your first dig. Tomorrow&apos;s will be different — every day is.
        </p>
      </footer>
    </main>
  );
}
