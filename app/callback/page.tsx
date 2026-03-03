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

    exchangeCodeForToken(code)
      .then((token) => {
        storeToken(token);
        router.replace('/orbit');
      })
      .catch((e) => {
        setError(e.message || 'Token exchange failed');
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100dvh', gap: 16, padding: 24 }}>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 600, color: '#1A1A1A' }}>
          Something went wrong
        </p>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, color: '#8A8A8A', textAlign: 'center' }}>
          {error}
        </p>
        <button
          onClick={() => { window.location.href = '/'; }}
          style={{
            marginTop: 8,
            padding: '12px 24px',
            background: '#1A1A1A',
            color: '#fff',
            border: 'none',
            borderRadius: 9999,
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 14,
            fontWeight: 500,
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
      <p style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#8A8A8A' }}>
        Connecting your Spotify...
      </p>
    </div>
  );
}

export default function Callback() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#8A8A8A' }}>
          Connecting your Spotify...
        </p>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
