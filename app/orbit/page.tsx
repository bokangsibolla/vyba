'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { logout } from '@/lib/spotify/auth';
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

const ORBIT_IDS = ['warmsignal', 'softdrift', 'nightdrive', 'otherside', 'static'];

function parsePlaylists(raw: any[], service: 'spotify' | 'deezer'): SavedPlaylist[] {
  return raw.map((pl: any, i: number) => ({
    orbitId: ORBIT_IDS[i] || 'warmsignal',
    label: pl.label,
    playlistId: pl.spotifyUrl?.split('/playlist/')[1]?.split('?')[0] ?? '',
    url: pl.spotifyUrl,
    trackCount: pl.trackCount,
    tracks: pl.tracks ?? [],
    service,
  }));
}

export default function OrbitPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [phase, setPhase] = useState<'loading' | 'done'>('loading');
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    const email = localStorage.getItem('vyba_email');
    if (!email) {
      router.replace('/');
      return;
    }

    const service = (localStorage.getItem('vyba_service') || 'spotify') as 'spotify' | 'deezer';

    // Check if callback already stored playlists
    const cached = localStorage.getItem('vyba_playlists');
    if (cached) {
      try {
        const raw = JSON.parse(cached);
        if (Array.isArray(raw) && raw.length > 0) {
          setPlaylists(parsePlaylists(raw, service));
          setPhase('done');
          localStorage.removeItem('vyba_playlists');
          // Fetch stats in background
          fetchStats(email);
          return;
        }
      } catch {
        // Fall through to API call
      }
    }

    // No cached playlists — call /api/discover
    async function runDiscovery() {
      try {
        const res = await fetch('/api/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Discovery failed' }));
          setError(data.error || `Server error ${res.status}`);
          return;
        }

        const data = await res.json();

        if (data.savedPlaylists) {
          setPlaylists(parsePlaylists(data.savedPlaylists, service));
        }

        setPhase('done');
        fetchStats(email!);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    }

    runDiscovery();
  }, [router]);

  async function fetchStats(email: string) {
    try {
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
    } catch {}
  }

  const animatedArtists = useCountUp(stats?.totalArtists ?? 0);

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
                setPlaylists([]);
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
    return <DiscoveryLoading progress={[]} />;
  }

  const currentGenreCount = playlists.length;
  const currentTrackCount = playlists.reduce((sum, pl) => sum + pl.trackCount, 0);
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
        {playlists.map((pl, i) => {
          const section = sectionColors[pl.orbitId as keyof typeof sectionColors];
          return (
            <div key={pl.orbitId + i} className={styles.playlistCard}>
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
