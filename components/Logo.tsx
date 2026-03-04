export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: "'Space Mono', monospace",
        fontWeight: 700,
        fontSize: size,
        color: '#E8622B',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      VYBA
    </span>
  );
}
