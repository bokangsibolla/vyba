import sharp from 'sharp';

async function generateIcons() {
  const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#FFFFFF" rx="64"/>
      <text x="256" y="360" font-family="sans-serif" font-size="320" font-weight="700" fill="#1A1A1A" text-anchor="middle">v</text>
    </svg>
  `;

  const buffer = Buffer.from(svg);

  await sharp(buffer).resize(512, 512).png().toFile('public/icon-512.png');
  await sharp(buffer).resize(192, 192).png().toFile('public/icon-192.png');

  console.log('Icons generated: public/icon-512.png, public/icon-192.png');
}

generateIcons();
