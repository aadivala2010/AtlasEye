/** A few hundred static stars behind the canvas. Server-rendered, deterministic, no JS, no twinkling. */
export default function Starfield() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const stars = Array.from({ length: 320 }, () => ({
    x: (rand() * 100).toFixed(2),
    y: (rand() * 100).toFixed(2),
    r: rand() < 0.92 ? 0.6 : 1.1,
    o: (0.12 + rand() ** 2 * 0.6).toFixed(2),
  }));
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {stars.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#C8D3E6" opacity={s.o} />
      ))}
    </svg>
  );
}
