// Not in lucide-react — this is Tabler Icons' "diamond" glyph (MIT licensed),
// hand-embedded to match lucide's own stroke conventions (currentColor, 2px
// stroke, round caps/joins) so it sits seamlessly among lucide-react icons.
export default function DiamondIcon({ size = 16.5, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 5h12l3 5l-8.5 9.5a.7 .7 0 0 1 -1 0l-8.5 -9.5l3 -5" />
      <path d="M10 12l-2 -2.2l.6 -1" />
    </svg>
  );
}
