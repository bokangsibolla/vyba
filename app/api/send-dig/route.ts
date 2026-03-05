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

interface SendDigRequest {
  email: string;
  displayName: string;
  playlists: PlaylistSection[];
}

const sectionInfo: Record<string, { bg: string; accent: string; tagline: string }> = {
  ROOTS:       { bg: '#3A2E1A', accent: '#D4A853', tagline: 'The artists who shaped your favorites' },
  EDGES:       { bg: '#1E2E1A', accent: '#7A9B5A', tagline: 'What fans of your music also love' },
  CROWD:       { bg: '#3A2218', accent: '#E8622B', tagline: 'New sounds from your emerging genres' },
  BLINDSPOT:   { bg: '#1A2A30', accent: '#5A9B9B', tagline: "Acclaimed music you haven't found yet" },
  'DEEP WORK': { bg: '#26252A', accent: '#8A8494', tagline: 'Instrumental focus fuel' },
  WILDCARD:    { bg: '#30192A', accent: '#C45A8A', tagline: 'A genre you\'ve never explored' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[]): string {
  const totalTracks = playlists.reduce((sum, p) => sum + p.trackCount, 0);
  const totalPlaylists = playlists.length;

  // Build compact preview sections — only 3 tracks per playlist
  const sections = playlists.map((pl) => {
    const colors = sectionInfo[pl.label] ?? { bg: '#2F2A22', accent: '#8A7E6E', tagline: '' };
    const preview = pl.tracks.slice(0, 3);

    const trackPreviews = preview.map((t) => {
      const trackLink = t.url
        ? `<a href="${t.url}" style="text-decoration:none;color:inherit;">`
        : '';
      const trackLinkEnd = t.url ? '</a>' : '';

      return `${trackLink}<span style="font-family:Arial,sans-serif;font-size:13px;color:#F0DFC8;">${t.name}</span> <span style="font-family:Arial,sans-serif;font-size:11px;color:#8A7E6E;">- ${t.artist}</span>${trackLinkEnd}`;
    }).join('<br/>');

    return `
      <div style="border:2px solid #3D362C;border-radius:12px;overflow:hidden;margin-bottom:16px;background:#252119;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="background:${colors.bg};padding:12px 16px;">
              <div style="font-family:Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;color:${colors.accent};text-transform:uppercase;">${pl.label}</div>
              <div style="font-family:Arial,sans-serif;font-size:12px;color:${colors.accent};opacity:0.7;margin-top:2px;">${colors.tagline}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;">
              ${trackPreviews}
              <div style="font-family:Courier,monospace;font-size:11px;color:#5A5347;margin-top:8px;">+ ${Math.max(0, pl.trackCount - 3)} more tracks</div>
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

  // Instagram-shareable card — a visually striking summary designed to be screenshotted
  const playlistNames = playlists.map(p => {
    const colors = sectionInfo[p.label] ?? { accent: '#8A7E6E' };
    return `<span style="color:${colors.accent};">${p.label}</span>`;
  }).join(' &middot; ');

  const shareCard = `
    <div style="background:linear-gradient(135deg, #1A1714 0%, #252119 50%, #1A1714 100%);border:2px solid #3D362C;border-radius:16px;padding:32px 24px;margin:24px 0;text-align:center;">
      <div style="font-family:Courier,monospace;font-size:11px;color:#5A5347;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">YOUR MUSICAL DNA</div>
      <div style="font-family:Georgia,serif;font-size:32px;color:#E8622B;font-weight:700;letter-spacing:0.04em;margin-bottom:4px;">VYBA</div>
      <div style="font-family:Courier,monospace;font-size:11px;color:#D4A853;letter-spacing:0.08em;margin-bottom:20px;">BUILT FOR ${name.toUpperCase()}</div>
      <div style="width:60px;height:2px;background:#E8622B;margin:0 auto 20px;"></div>
      <div style="font-family:Georgia,serif;font-size:20px;color:#F0DFC8;line-height:1.4;margin-bottom:16px;">${totalPlaylists} playlists. ${totalTracks} tracks.<br/>Zero songs you've heard before.</div>
      <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.06em;margin-bottom:12px;">${playlistNames}</div>
      <div style="width:60px;height:2px;background:#3D362C;margin:0 auto 16px;"></div>
      <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;">Screenshot this &middot; Share to your story</div>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1A1714;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif;">
    <h1 style="font-family:Courier,monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;color:#E8622B;margin:0;">VYBA</h1>
    <p style="font-family:Courier,monospace;font-size:11px;color:#D4A853;letter-spacing:0.1em;text-transform:uppercase;margin:6px 0 0;">Your Daily Dig</p>
    <hr style="border:none;border-top:2px solid #3D362C;margin:16px 0 24px;" />

    <h2 style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#F0DFC8;margin:0 0 8px;line-height:1.3;">
      Hey ${name}. We analyzed your listening and found ${totalTracks} songs you've never heard.
    </h2>
    <p style="font-family:Courier,monospace;font-size:12px;color:#8A7E6E;letter-spacing:0.04em;margin:0 0 28px;">
      ${totalPlaylists} playlists, each digging into a different side of your taste.
    </p>

    ${sections}

    ${shareCard}

    <hr style="border:none;border-top:1px solid #3D362C;margin:24px 0;" />
    <p style="font-family:Courier,monospace;font-size:11px;color:#5A5347;text-align:center;letter-spacing:0.04em;">
      vyba &middot; read only &middot; never posts anything
    </p>
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
  const html = buildEmailHtml(body.displayName || 'friend', body.playlists);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'VYBA', email: 'sibollabokang@gmail.com' },
      to: [{ email: body.email }],
      subject: `Your dig is ready — ${body.playlists.length} playlists of music you've never heard`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ sent: true });
}
