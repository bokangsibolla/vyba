'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { getDeezerToken } from '@/lib/deezer/auth';
import { createMusicService, MusicService } from '@/lib/music';
import { runDiscoveryEngine } from '@/lib/engine';
import { EngineState, DiscoveryOrbit } from '@/lib/engine/types';
import { sectionColors } from '@/lib/tokens';
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

interface DiscoveryStats {
  totalArtists: number;
  totalTracks: number;
  totalDigs: number;
  currentStreak: number;
  topGenres: string[];
  firstGenres?: string[];
  latestGenres?: string[];
}

function getEmbedSrc(pl: SavedPlaylist): string {
  if (pl.service === 'deezer') {
    return `https://widget.deezer.com/widget/dark/playlist/${pl.playlistId}`;
  }
  return `https://open.spotify.com/embed/playlist/${pl.playlistId}?utm_source=generator&theme=0`;
}

function useCountUp(target: number, duration = 1500): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function getUniqueClusters(genres: string[]): number {
  const clusters = new Set(genres.map(g => g.toLowerCase().trim()));
  return clusters.size;
}

function getTasteShift(stats: DiscoveryStats): string | null {
  if (stats.totalDigs < 3) return null;
  const first = stats.firstGenres ?? [];
  const latest = stats.latestGenres ?? [];
  if (first.length === 0 || latest.length === 0) return null;
  const firstSet = new Set(first.map(g => g.toLowerCase()));
  const latestSet = new Set(latest.map(g => g.toLowerCase()));
  const shifted = [...latestSet].some(g => !firstSet.has(g));
  if (!shifted) return null;
  const from = first[0]?.toLowerCase() ?? '';
  const to = latest.find(g => !firstSet.has(g.toLowerCase()))?.toLowerCase() ?? latest[0]?.toLowerCase() ?? '';
  if (from === to) return null;
  return `started in ${from}. now exploring ${to}.`;
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
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
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
      .catch((e) => {
        console.error('[vyba] Engine error:', e);
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

      // Track discovery stats
      const email = localStorage.getItem('vyba_email');
      if (email && saved.length > 0) {
        try {
          // Count unique artists across all saved playlists
          const uniqueArtists = new Set<string>();
          let totalTracks = 0;
          const genres: string[] = [];

          for (const pl of saved) {
            for (const track of pl.tracks) {
              uniqueArtists.add(track.artist);
            }
            totalTracks += pl.trackCount;
            genres.push(pl.label);
          }

          // POST stats for this dig
          await fetch('/api/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              artistsDiscovered: uniqueArtists.size,
              tracksDiscovered: totalTracks,
              playlistsCreated: saved.length,
              genres,
            }),
          });

          // GET cumulative stats
          const statsRes = await fetch(`/api/stats?email=${encodeURIComponent(email)}`);
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            setStats({
              totalArtists: statsData.totalArtists,
              totalTracks: statsData.totalTracks,
              totalDigs: statsData.totalDigs,
              currentStreak: statsData.currentStreak,
              topGenres: statsData.topGenres,
              firstGenres: statsData.firstGenres,
              latestGenres: statsData.latestGenres,
            });
          }
        } catch {
          // Stats tracking is non-blocking
        }

        // Send dig email
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

          // Fetch latest stats for email
          let emailStats: { totalDigs: number; totalArtists: number; currentStreak: number } | null = null;
          try {
            const sr = await fetch(`/api/stats?email=${encodeURIComponent(email)}`);
            if (sr.ok) emailStats = await sr.json();
          } catch {}

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
              stats: emailStats ? {
                digNumber: emailStats.totalDigs,
                artistsDiscovered: emailStats.totalArtists,
                streak: emailStats.currentStreak,
              } : undefined,
            }),
          });
          if (res.ok) {
            console.log('[vyba] Dig email sent');
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
          <p className={styles.errorMessage} style={{ whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: 11, maxWidth: 340 }}>{error}</p>
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
    return <DiscoveryLoading progress={engineState.progress} />;
  }

  // Compute current dig's genre count from saved playlists
  const currentGenreCount = playlists.length;
  const currentTrackCount = playlists.reduce((sum, pl) => sum + pl.trackCount, 0);
  const animatedArtists = useCountUp(stats?.totalArtists ?? 0);
  const tasteBreadth = stats ? getUniqueClusters(stats.topGenres) : 0;
  const tasteShift = stats ? getTasteShift(stats) : null;

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

      {stats && (
        <motion.div
          className={styles.signalCard}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <span className={styles.digNumber}>DIG #{stats.totalDigs}</span>
          <div className={styles.bigNumber}>{animatedArtists}</div>
          <span className={styles.bigLabel}>artists discovered</span>
          {tasteBreadth > 0 && (
            <span className={styles.tasteBreadth}>{tasteBreadth} genre clusters</span>
          )}
          <div className={styles.statRow}>
            <div className={styles.statItem}>
              <span className={`${styles.statNumber} ${stats.currentStreak > 1 ? styles.streakActive : ''}`}>
                {stats.currentStreak}
                {stats.currentStreak > 1 && <span className={styles.onFire}>on fire</span>}
              </span>
              <span className={styles.statLabel}>day streak</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{currentTrackCount}</span>
              <span className={styles.statLabel}>new tracks</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>{currentGenreCount}</span>
              <span className={styles.statLabel}>genres</span>
            </div>
          </div>
          {tasteShift && (
            <p className={styles.tasteShift}>{tasteShift}</p>
          )}
        </motion.div>
      )}

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
              </div>
              <iframe
                src={getEmbedSrc(pl)}
                width="100%"
                height="152"
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
          come back tomorrow
        </p>
      </footer>
    </main>
  );
}
