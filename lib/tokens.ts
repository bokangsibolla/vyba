export const colors = {
  bg: '#FFFFFF',
  surface: '#F8F8F8',
  text: '#1A1A1A',
  textMuted: '#8A8A8A',
  accent: '#1DB954',
  border: '#EBEBEB',
} as const;

export const vibeColors = [
  { name: 'coral', from: '#FFB5A7', to: '#FEC5BB' },
  { name: 'lavender', from: '#C8B6FF', to: '#E2D1F9' },
  { name: 'mint', from: '#A8E6CF', to: '#C1F0D8' },
  { name: 'sky', from: '#A0C4FF', to: '#BDD5FF' },
  { name: 'peach', from: '#FFD6A5', to: '#FFE5C4' },
  { name: 'sage', from: '#B5E48C', to: '#D4F0B0' },
  { name: 'rose', from: '#FFAFCC', to: '#FFC8DD' },
] as const;

export const fonts = {
  family: "'Space Grotesk', sans-serif",
  weight: { regular: 400, medium: 500, bold: 700 },
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 16, pill: 9999,
} as const;

export const orbitColors = {
  roots: { name: 'lavender', from: '#C8B6FF', to: '#E2D1F9' },
  edges: { name: 'mint', from: '#A8E6CF', to: '#C1F0D8' },
  crowd: { name: 'peach', from: '#FFD6A5', to: '#FFE5C4' },
  blindspot: { name: 'sky', from: '#A0C4FF', to: '#BDD5FF' },
} as const;

export const orbitMeta = {
  roots: { label: 'Your Roots', description: 'Artists who shaped the music you love' },
  edges: { label: 'Your Edges', description: 'Where your taste is heading next' },
  crowd: { label: 'Your Crowd', description: "What similar listeners can't stop playing" },
  blindspot: { label: 'Your Blindspot', description: "Important artists you've never explored" },
} as const;
