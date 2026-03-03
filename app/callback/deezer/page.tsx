'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function DeezerCallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = params.get('token');
    if (!token) {
      router.replace('/');
      return;
    }

    localStorage.setItem('vyba_deezer_token', token);

    const email = localStorage.getItem('vyba_email');
    if (email) {
      import('@/lib/supabase/connections').then(({ saveDeezerConnection }) => {
        saveDeezerConnection(email, token).catch(() => {});
      });
    }

    router.replace('/orbit');
  }, [params, router]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
      <p style={{ fontFamily: "'Space Mono', monospace", color: '#6B6B6B' }}>
        Connecting your Deezer...
      </p>
    </div>
  );
}

export default function DeezerCallback() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
        <p style={{ fontFamily: "'Space Mono', monospace", color: '#6B6B6B' }}>
          Connecting your Deezer...
        </p>
      </div>
    }>
      <DeezerCallbackHandler />
    </Suspense>
  );
}
