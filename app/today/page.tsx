'use client';

import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import PlaylistCard from '@/components/PlaylistCard';
import { DiscoveryOrbit } from '@/lib/engine/types';
import { sectionColors } from '@/lib/tokens';
import styles from './page.module.css';

interface DailyIssue {
  issue_number: number;
  dj_intro: string;
  dj_teaser: string;
  sections: {
    id: string;
    label: string;
    tagline: string;
    tracks: {
      id: string;
      name: string;
      artists: { id: string; name: string }[];
      album: {
        id: string;
        name: string;
        images: { url: string; width: number; height: number }[];
      };
      uri: string;
      preview_url: string | null;
      external_urls: { spotify: string };
    }[];
    playlist_url?: string;
  }[];
}

export default function TodayPage() {
  const [issue, setIssue] = useState<DailyIssue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadIssue = async () => {
      try {
        const email = localStorage.getItem('vyba_email');
        if (!email) {
          setLoading(false);
          return;
        }

        const { supabase } = await import('@/lib/supabase/client');

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, issue_number')
          .eq('email', email.toLowerCase())
          .single();

        if (!profile) {
          setLoading(false);
          return;
        }

        const { data: dailyIssue } = await supabase
          .from('daily_issues')
          .select('*')
          .eq('user_id', profile.id)
          .eq('issue_number', profile.issue_number)
          .single();

        if (dailyIssue) {
          setIssue(dailyIssue as unknown as DailyIssue);
        }
      } catch {
        // Fail silently
      } finally {
        setLoading(false);
      }
    };

    loadIssue();
  }, []);

  if (loading) {
    return (
      <main className={styles.main}>
        <p style={{ fontFamily: "'Space Mono', monospace", color: '#6B6B6B', textAlign: 'center', marginTop: '40vh' }}>
          Loading your daily dig...
        </p>
      </main>
    );
  }

  if (!issue) {
    return (
      <main className={styles.main}>
        <div className={styles.empty}>
          <Logo size={28} />
          <p className={styles.emptyTitle}>No issue yet</p>
          <p className={styles.emptyDesc}>
            Your first daily dig drops tomorrow morning at 7am.
          </p>
        </div>
      </main>
    );
  }

  // Map sections to DiscoveryOrbit format for PlaylistCard reuse
  const orbits: DiscoveryOrbit[] = issue.sections.map(s => {
    const color = sectionColors[s.id as keyof typeof sectionColors];
    return {
      id: s.id as any,
      label: s.label,
      description: s.tagline,
      color: {
        name: s.id,
        from: color?.bg ?? '#F0EBE3',
        to: color?.accent ?? '#888',
      },
      tracks: s.tracks,
      artists: [],
      confidence: 1,
      status: 'ready' as const,
    };
  });

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={24} />
        <p className={styles.issueLine}>
          Issue #{String(issue.issue_number).padStart(3, '0')} — {today}
        </p>
      </header>

      <p className={styles.djIntro}>{issue.dj_intro}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {orbits.map((orbit) => (
          <PlaylistCard key={orbit.id} orbit={orbit} />
        ))}
      </div>

      <p className={styles.teaser}>{issue.dj_teaser}</p>
    </main>
  );
}
