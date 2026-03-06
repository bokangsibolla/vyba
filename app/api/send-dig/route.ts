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
  'warm signal':  { accent: '#D4A853' },
  'soft drift':   { accent: '#7A9B5A' },
  'night drive':  { accent: '#E8622B' },
  'other side':   { accent: '#5A9B9B' },
  'static':       { accent: '#C45A8A' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[], stats?: DigStats): string {
  const totalTracks = playlists.reduce((sum, p) => sum + p.trackCount, 0);

  const hookLine = stats
    ? `<p style="font-family:Courier,monospace;font-size:11px;color:#5A5347;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 24px;">Dig #${stats.digNumber}${stats.streak > 1 ? ` / ${stats.streak} day streak` : ''}</p>`
    : '';

  // Simple playlist links — no track previews, no cards, just names you can tap
  const playlistLinks = playlists.map((pl) => {
    const colors = sectionInfo[pl.label] ?? { accent: '#8A7E6E' };
    return `<tr>
      <td style="padding:10px 0;">
        <a href="${pl.spotifyUrl}" style="text-decoration:none;display:block;">
          <span style="font-family:Courier,monospace;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${colors.accent};">${pl.label}</span>
          <span style="font-family:Arial,sans-serif;font-size:12px;color:#5A5347;margin-left:8px;">${pl.trackCount} tracks</span>
        </a>
      </td>
    </tr>`;
  }).join('');

  const statsLine = stats
    ? `<p style="font-family:Courier,monospace;font-size:10px;color:#3D362C;letter-spacing:0.06em;text-transform:uppercase;margin:32px 0 0;">${stats.artistsDiscovered} artists discovered so far</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1A1714;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;font-family:Arial,sans-serif;">
    <div style="font-family:Courier,monospace;font-size:20px;font-weight:700;letter-spacing:0.08em;color:#E8622B;margin:0 0 32px;">VYBA</div>

    ${hookLine}
    <p style="font-family:Georgia,serif;font-size:20px;font-weight:400;color:#F0DFC8;margin:0 0 8px;line-height:1.3;">Hey ${name}.</p>
    <p style="font-family:Georgia,serif;font-size:15px;font-weight:400;color:#8A7E6E;margin:0 0 32px;line-height:1.5;">${totalTracks} tracks across ${playlists.length} playlists. All queued up, just hit play.</p>

    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #2E2924;">
      ${playlistLinks}
    </table>

    ${statsLine}
    <p style="font-family:Courier,monospace;font-size:10px;color:#2E2924;text-align:center;letter-spacing:0.06em;margin:40px 0 0;">vyba</p>
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
