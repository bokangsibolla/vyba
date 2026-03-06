import { NextResponse } from 'next/server';

interface TrackInfo {
  name: string;
  artist: string;
  url?: string;
}

interface PlaylistSection {
  label: string;
  spotifyUrl: string;
  trackCount: number;
  tracks: TrackInfo[];
}

interface DigStats {
  digNumber: number;
  artistsDiscovered: number;
  streak: number;
}

interface SendDigRequest {
  email: string;
  displayName: string;
  playlists: PlaylistSection[];
  stats?: DigStats;
}

const sectionInfo: Record<string, { accent: string }> = {
  'warm signal':  { accent: '#B8860B' },
  'soft drift':   { accent: '#4A7C4A' },
  'night drive':  { accent: '#C44B1A' },
  'other side':   { accent: '#3A7A7A' },
  'static':       { accent: '#9A3A6A' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[], stats?: DigStats): string {
  const totalTracks = playlists.reduce((sum, p) => sum + p.trackCount, 0);

  const digLine = stats
    ? `<p style="font-family:Courier New,Courier,monospace;font-size:11px;color:#8A7E6E;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 28px;border-bottom:1px solid #E0D8CC;padding-bottom:16px;">No. ${stats.digNumber}${stats.streak > 1 ? ` &mdash; ${stats.streak} day streak` : ''}</p>`
    : '';

  const playlistRows = playlists.map((pl) => {
    const colors = sectionInfo[pl.label] ?? { accent: '#5A5347' };
    // Show first 3 artist names as a taste hint
    const artistHint = pl.tracks.slice(0, 3).map(t => t.artist).join(' · ');
    return `<tr>
      <td style="padding:14px 0;border-bottom:1px solid #EDEBE6;">
        <a href="${pl.spotifyUrl}" style="text-decoration:none;display:block;">
          <span style="font-family:Courier New,Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${colors.accent};">${pl.label}</span>
          <span style="font-family:Georgia,serif;font-size:12px;color:#8A7E6E;margin-left:10px;">${pl.trackCount} tracks</span>
          <p style="font-family:Georgia,serif;font-size:11px;color:#A89F92;margin:4px 0 0;line-height:1.4;font-style:italic;">${artistHint}</p>
        </a>
      </td>
    </tr>`;
  }).join('');

  const statsLine = stats
    ? `<p style="font-family:Courier New,Courier,monospace;font-size:10px;color:#8A7E6E;letter-spacing:0.08em;text-transform:uppercase;margin:28px 0 0;">${stats.artistsDiscovered} artists discovered so far</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F2ED;">
  <div style="max-width:480px;margin:0 auto;padding:48px 28px;font-family:Georgia,serif;">
    <div style="font-family:Courier New,Courier,monospace;font-size:18px;font-weight:700;letter-spacing:0.14em;color:#C44B1A;margin:0 0 36px;">VYBA</div>

    ${digLine}
    <p style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#2A2520;margin:0 0 6px;line-height:1.3;">Hey ${name}.</p>
    <p style="font-family:Georgia,serif;font-size:14px;font-weight:400;color:#5A5347;margin:0 0 32px;line-height:1.6;">${totalTracks} tracks across ${playlists.length} playlists. Tap any to open in Spotify.</p>

    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #D6D0C6;">
      ${playlistRows}
    </table>

    ${statsLine}
    <p style="font-family:Courier New,Courier,monospace;font-size:9px;color:#C4BAB0;text-align:center;letter-spacing:0.1em;text-transform:uppercase;margin:44px 0 0;">vyba &mdash; new music, every morning</p>
  </div>
</body>
</html>`;
}

export async function POST(request: Request) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  const body: SendDigRequest = await request.json();
  const html = buildEmailHtml(body.displayName || 'friend', body.playlists, body.stats);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'VYBA', email: 'sibollabokang@gmail.com' },
      to: [{ email: body.email }],
      subject: stats_subject(body.stats),
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ sent: true });
}

function stats_subject(stats?: DigStats): string {
  if (!stats) return 'your dig is ready';
  if (stats.streak > 1) return `dig #${stats.digNumber} / ${stats.streak} day streak`;
  return `dig #${stats.digNumber} is ready`;
}
