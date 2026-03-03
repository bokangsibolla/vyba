export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: size,
        color: '#1A1A1A',
        letterSpacing: '-0.02em',
      }}
    >
      vyba
    </span>
  );
}
