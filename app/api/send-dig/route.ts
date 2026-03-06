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

const sectionInfo: Record<string, { bg: string; accent: string }> = {
  'warm signal':  { bg: '#3A2E1A', accent: '#D4A853' },
  'soft drift':   { bg: '#1E2E1A', accent: '#7A9B5A' },
  'night drive':  { bg: '#3A2218', accent: '#E8622B' },
  'other side':   { bg: '#1A2A30', accent: '#5A9B9B' },
  'static':       { bg: '#30192A', accent: '#C45A8A' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[], stats?: DigStats): string {
  const totalTracks = playlists.reduce((sum, p) => sum + p.trackCount, 0);
  const totalPlaylists = playlists.length;

  const hookLine = stats
    ? `<p style="font-family:Courier,monospace;font-size:12px;color:#5A5347;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 20px;">Dig #${stats.digNumber}. ${stats.streak} day streak.</p>`
    : '';

  const statsBlock = stats
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;border:1px solid #2E2924;border-radius:10px;overflow:hidden;background:#1E1B17;">
        <tr>
          <td style="padding:20px 24px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:36px;color:#F0DFC8;line-height:1;">${stats.artistsDiscovered}</div>
            <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">artists discovered</div>
          </td>
          <td style="padding:20px 24px;text-align:center;border-left:1px solid #2E2924;">
            <div style="font-family:Courier,monospace;font-size:20px;font-weight:700;color:${stats.streak > 1 ? '#E8622B' : '#F0DFC8'};line-height:1;">${stats.streak}</div>
            <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">day streak</div>
          </td>
          <td style="padding:20px 24px;text-align:center;border-left:1px solid #2E2924;">
            <div style="font-family:Courier,monospace;font-size:20px;font-weight:700;color:#F0DFC8;line-height:1;">#${stats.digNumber}</div>
            <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">dig</div>
          </td>
        </tr>
      </table>`
    : '';

  const sections = playlists.map((pl) => {
    const colors = sectionInfo[pl.label] ?? { bg: '#2F2A22', accent: '#8A7E6E' };
    const preview = pl.tracks.slice(0, 3);

    const trackPreviews = preview.map((t) => {
      const trackLink = t.url
        ? `<a href="${t.url}" style="text-decoration:none;color:inherit;">`
        : '';
      const trackLinkEnd = t.url ? '</a>' : '';

      return `${trackLink}<span style="font-family:Arial,sans-serif;font-size:13px;color:#F0DFC8;">${t.name}</span> <span style="font-family:Arial,sans-serif;font-size:11px;color:#8A7E6E;">- ${t.artist}</span>${trackLinkEnd}`;
    }).join('<br/>');

    return `
      <div style="border:1px solid #2E2924;border-radius:10px;overflow:hidden;margin-bottom:14px;background:#211E18;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="background:${colors.bg};padding:10px 16px;">
              <div style="font-family:Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;color:${colors.accent};text-transform:uppercase;">${pl.label}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;">
              ${trackPreviews}
            </td>
          </tr>
          ${pl.spotifyUrl ? `<tr>
            <td style="padding:0 16px 14px;">
              <a href="${pl.spotifyUrl}" style="display:inline-block;font-family:Courier,monospace;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1A1714;background:${colors.accent};padding:8px 16px;border-radius:6px;text-decoration:none;">Open playlist</a>
            </td>
          </tr>` : ''}
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1A1714;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="font-family:Courier,monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:#E8622B;margin:0 0 32px;">VYBA</div>

    ${hookLine}
    <p style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#F0DFC8;margin:0 0 6px;line-height:1.3;">Hey ${name}.</p>
    <p style="font-family:Georgia,serif;font-size:16px;font-weight:400;color:#A89E8E;margin:0 0 28px;line-height:1.5;">We went through your listening and pulled ${totalTracks} songs you've never heard. ${totalPlaylists} playlists, all new artists.</p>

    ${statsBlock}

    ${sections}

    <p style="font-family:Courier,monospace;font-size:11px;color:#3D362C;text-align:center;letter-spacing:0.06em;margin:32px 0 0;">vyba</p>
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
      subject: body.stats ? `dig #${body.stats.digNumber} is ready` : 'your dig is ready',
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ sent: true });
}
