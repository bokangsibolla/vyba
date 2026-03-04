'use client';

import { useEffect, useState } from 'react';

export default function DebugPage() {
  const [info, setInfo] = useState<string[]>(['Loading...']);

  useEffect(() => {
    async function run() {
      const lines: string[] = [];

      const raw = localStorage.getItem('vyba_token');
      if (!raw) {
        setInfo(['No token found. Go to / and connect Spotify first.']);
        return;
      }

      const stored = JSON.parse(raw);
      lines.push(`Token exists: yes`);
      lines.push(`Token scope field: ${stored.scope ?? 'NOT STORED'}`);
      lines.push(`Token keys: ${Object.keys(stored).join(', ')}`);
      lines.push('');

      // Test /me
      try {
        const meRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${stored.access_token}` },
        });
        const me = await meRes.json();
        lines.push(`GET /me: ${meRes.status}`);
        lines.push(`User: ${me.id} (${me.email})`);
        lines.push(`Product: ${me.product}`);
        lines.push('');

        // Test playlist creation
        const createRes = await fetch(
          `https://api.spotify.com/v1/users/${me.id}/playlists`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${stored.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: 'vyba debug test', public: false }),
          }
        );
        const createBody = await createRes.text();
        lines.push(`POST /users/${me.id}/playlists: ${createRes.status}`);
        lines.push(`Response: ${createBody}`);

        if (createRes.ok) {
          // Clean up - delete the test playlist
          const playlist = JSON.parse(createBody);
          lines.push(`SUCCESS - playlist created: ${playlist.id}`);
          await fetch(
            `https://api.spotify.com/v1/playlists/${playlist.id}/followers`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${stored.access_token}` },
            }
          );
          lines.push('Test playlist unfollowed (cleaned up)');
        }
      } catch (e) {
        lines.push(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }

      setInfo(lines);
    }

    run();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>
      <h1 style={{ fontSize: 16, marginBottom: 16 }}>VYBA Debug</h1>
      {info.map((line, i) => (
        <div key={i} style={{ color: line.includes('403') || line.includes('Error') ? '#c44' : line.includes('SUCCESS') ? '#2d8b4e' : '#111' }}>
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
}
