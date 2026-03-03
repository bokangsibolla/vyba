'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCodeForToken, storeToken } from '@/lib/spotify/auth';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    const err = searchParams.get('error');

    if (err) {
      setError(`Spotify error: ${err}`);
      return;
    }

    if (!code) {
      router.replace('/');
      return;
    }

    async function handleCallback(authCode: string) {
      try {
        const token = await exchangeCodeForToken(authCode);
        storeToken(token);

        // Grab email from Spotify profile and save to Supabase
        try {
          const me = await fetch('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${token.access_token}` },
          }).then(r => r.json());

          const email = me.email;
          if (email) {
            localStorage.setItem('vyba_email', email);
            const { saveSpotifyConnection } = await import('@/lib/supabase/connections');
            await saveSpotifyConnection(
              email,
              token.access_token,
              token.refresh_token,
              token.expires_in,
              me.id,
            );
          }
        } catch {
          // Non-blocking
        }

        router.replace('/orbit');
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Token exchange failed';
        setError(message);
      }
    }

    handleCallback(code);
  }, [searchParams, router]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100dvh', gap: 16, padding: 24 }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 16, fontWeight: 700, color: '#111' }}>
          Something went wrong
        </p>
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: '#999', textAlign: 'center' }}>
          {error}
        </p>
        <button
          onClick={() => { window.location.href = '/'; }}
          style={{
            marginTop: 8,
            padding: '14px 24px',
            background: '#111',
            color: '#FFFDF5',
            border: 'none',
            borderRadius: 8,
            fontFamily: "'Space Mono', monospace",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
      <p style={{ fontFamily: "'Space Mono', monospace", color: '#999', fontSize: 12, letterSpacing: '0.04em' }}>
        Connecting your Spotify...
      </p>
    </div>
  );
}

export default function Callback() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
        <p style={{ fontFamily: "'Space Mono', monospace", color: '#999', fontSize: 12, letterSpacing: '0.04em' }}>
          Connecting your Spotify...
        </p>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
