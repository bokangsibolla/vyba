'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, redirectToSpotifyAuth } from '@/lib/spotify/auth';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const hasToken = typeof window !== 'undefined' && !!getStoredToken();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    try {
      const { supabase } = await import('@/lib/supabase/client');
      const { error } = await supabase
        .from('profiles')
        .upsert({ email: email.trim().toLowerCase() }, { onConflict: 'email' });
      if (error) throw error;
      localStorage.setItem('vyba_email', email);
      setSubmitted(true);
    } catch {
      localStorage.setItem('vyba_email', email);
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <Logo size={36} />
        <span className={styles.badge}>Your Daily Dig</span>
        <p className={styles.tagline}>
          Fresh music in your inbox. Every morning.
        </p>
        <p className={styles.sub}>
          60+ songs across 6 sections — roots, edges, deep work, wildcards —
          tailored to your taste. Like having a DJ who knows your sound.
        </p>

        {submitted ? (
          <>
            <p className={styles.successMessage}>
              You&apos;re in. Now connect your music to get started.
            </p>
            <button className={styles.submitBtn} onClick={redirectToSpotifyAuth}>
              Connect Spotify
            </button>
          </>
        ) : hasToken ? (
          <button className={styles.submitBtn} onClick={() => router.push('/orbit')}>
            Open your orbits
          </button>
        ) : (
          <form className={styles.emailForm} onSubmit={handleSubmit}>
            <input
              type="email"
              className={styles.emailInput}
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Joining...' : 'Get Started'}
            </button>
            <div className={styles.divider}>or</div>
            <button type="button" className={styles.connectBtn} onClick={redirectToSpotifyAuth}>
              Skip — Connect Spotify directly
            </button>
          </form>
        )}

        <p className={styles.note}>
          We only read your listening history. Nothing is posted or shared.
        </p>
      </div>
    </main>
  );
}
