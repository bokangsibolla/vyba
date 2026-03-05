'use client';

import { useEffect, useState } from 'react';

export default function DebugPage() {
  const [lines, setLines] = useState<string[]>(['Loading...']);

  useEffect(() => {
    async function run() {
      const log: string[] = [];
      const push = (s: string) => { log.push(s); setLines([...log]); };

      const raw = localStorage.getItem('vyba_token');
      if (!raw) {
        setLines(['No token found. Go to / and connect Spotify first.']);
        return;
      }

      const stored = JSON.parse(raw);
      const token = stored.access_token;

      // Helper
      async function api(path: string) {
        const res = await fetch(`https://api.spotify.com/v1${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status} ${path}`);
        return res.json();
      }

      push('=== VYBA Discovery Algorithm Verification ===');
      push('');

      // Step 1: Verify scopes by testing library endpoints
      push('STEP 1: Testing OAuth scopes...');
      try {
        await api('/me/tracks?limit=1');
        push('[PASS] user-library-read scope works');
      } catch (e) {
        push(`[FAIL] user-library-read: ${e instanceof Error ? e.message : e}`);
        push('>>> ROOT CAUSE: Missing scope. User needs to re-authorize.');
      }
      try {
        await api('/me/following?type=artist&limit=1');
        push('[PASS] user-follow-read scope works');
      } catch (e) {
        push(`[FAIL] user-follow-read: ${e instanceof Error ? e.message : e}`);
      }
      push('');

      // Step 2: Get user's top artists
      push('STEP 2: Loading your top artists...');
      const topArtists = await api('/me/top/artists?time_range=medium_term&limit=50');
      const userArtistNames = new Set<string>(topArtists.items.map((a: { name: string }) => a.name.toLowerCase()));
      push(`You have ${topArtists.items.length} top artists`);
      push(`First 10: ${topArtists.items.slice(0, 10).map((a: { name: string }) => a.name).join(', ')}`);
      push('');

      // Step 3: Build full exclusion list
      push('STEP 3: Building exclusion list...');
      const saved = await api('/me/tracks?limit=50');
      const savedArtists = new Set<string>();
      const savedTrackIds = new Set<string>();
      for (const item of saved.items) {
        savedTrackIds.add(item.track.id);
        for (const a of item.track.artists) {
          savedArtists.add(a.name.toLowerCase());
        }
      }
      for (const name of savedArtists) userArtistNames.add(name);

      const followed = await api('/me/following?type=artist&limit=50');
      for (const a of followed.artists.items) {
        userArtistNames.add(a.name.toLowerCase());
      }
      push(`Total known artists: ${userArtistNames.size}`);
      push(`Saved tracks: ${savedTrackIds.size}`);
      push('');

      // Step 4: Find related artists and get their tracks
      push('STEP 4: Finding new artists via Related Artists...');
      const newArtists: { id: string; name: string }[] = [];
      for (const artist of topArtists.items.slice(0, 3)) {
        const related = await api(`/artists/${artist.id}/related-artists`);
        for (const r of related.artists) {
          if (!userArtistNames.has(r.name.toLowerCase())) {
            newArtists.push({ id: r.id, name: r.name });
          }
        }
      }
      push(`Found ${newArtists.length} NEW related artists`);
      push('');

      // Step 5: Get tracks from new artists
      push('STEP 5: Getting top tracks from new artists...');
      const candidateTracks: { name: string; artist: string; id: string }[] = [];
      for (const artist of newArtists.slice(0, 5)) {
        try {
          const topTracks = await api(`/artists/${artist.id}/top-tracks`);
          for (const t of topTracks.tracks.slice(0, 3)) {
            if (!userArtistNames.has(t.artists[0].name.toLowerCase())) {
              candidateTracks.push({ name: t.name, artist: t.artists[0].name, id: t.id });
            }
          }
        } catch { /* skip */ }
      }
      push(`Got ${candidateTracks.length} candidate tracks`);
      push('');

      // Step 6: THE KEY TEST — verify with /me/tracks/contains
      push('STEP 6: VERIFYING candidates against your library via /me/tracks/contains...');
      const trackIds = candidateTracks.map(t => t.id);
      let libraryResults: boolean[] = [];
      if (trackIds.length > 0) {
        try {
          const ids = trackIds.slice(0, 50).join(',');
          libraryResults = await api(`/me/tracks/contains?ids=${ids}`);
          push(`[PASS] /me/tracks/contains returned ${libraryResults.length} results`);
        } catch (e) {
          push(`[FAIL] /me/tracks/contains: ${e instanceof Error ? e.message : e}`);
        }
      }
      push('');

      // Step 7: Show verified results
      push('=== VERIFIED RESULTS ===');
      push('');

      let inLibraryCount = 0;
      let newCount = 0;
      for (let i = 0; i < candidateTracks.length; i++) {
        const t = candidateTracks[i];
        const inLib = libraryResults[i] ?? false;
        if (inLib) {
          push(`[IN LIBRARY - EXCLUDED] ${t.name} - ${t.artist}`);
          inLibraryCount++;
        } else {
          push(`[VERIFIED NEW] ${t.name} - ${t.artist}`);
          newCount++;
        }
      }
      push('');

      // Also check artist follow status
      push('=== ARTIST FOLLOW STATUS ===');
      const artistCheckIds = newArtists.slice(0, 10).map(a => a.id);
      if (artistCheckIds.length > 0) {
        try {
          const followResults = await api(`/me/following/contains?type=artist&ids=${artistCheckIds.join(',')}`);
          for (let i = 0; i < Math.min(artistCheckIds.length, followResults.length); i++) {
            const artist = newArtists[i];
            const isFollowed = followResults[i];
            push(`${isFollowed ? '[FOLLOWED]' : '[NOT FOLLOWED]'} ${artist.name}`);
          }
        } catch (e) {
          push(`Could not check follow status: ${e instanceof Error ? e.message : e}`);
        }
      }
      push('');

      push('=== SUMMARY ===');
      push(`Tracks in library (correctly excluded): ${inLibraryCount}`);
      push(`Verified NEW tracks: ${newCount}`);
      push(`Known artists: ${userArtistNames.size}`);
      push('');
      if (inLibraryCount === 0 && newCount > 0) {
        push('[SUCCESS] All candidate tracks are genuinely NEW!');
      } else if (inLibraryCount > 0) {
        push(`[WORKING] Library verification correctly caught ${inLibraryCount} tracks that would have slipped through.`);
      } else {
        push('[WARNING] No candidates found — check artist pool.');
      }
    }

    run().catch(e => setLines([`Error: ${e.message}`]));
  }, []);

  return (
    <div style={{
      padding: 24,
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: 1.8,
      background: '#1A1714',
      color: '#F0DFC8',
      minHeight: '100dvh',
    }}>
      <h1 style={{ fontSize: 16, marginBottom: 16, color: '#E8622B' }}>VYBA Discovery Verification</h1>
      {lines.map((line, i) => (
        <div key={i} style={{
          color: line.includes('[FAIL]') ? '#E8622B'
            : line.includes('[PASS]') ? '#7A9B5A'
            : line.includes('[VERIFIED NEW]') ? '#7A9B5A'
            : line.includes('[IN LIBRARY') ? '#E8622B'
            : line.includes('[SUCCESS]') ? '#7A9B5A'
            : line.includes('[WORKING]') ? '#D4A853'
            : line.includes('[WARNING]') ? '#E8622B'
            : line.includes('[NOT FOLLOWED]') ? '#7A9B5A'
            : line.includes('[FOLLOWED]') ? '#E8622B'
            : line.startsWith('===') ? '#D4A853'
            : line.startsWith('STEP') ? '#5A9B9B'
            : '#8A7E6E',
        }}>
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
}
