import { useMemo } from 'react'
import type { MasteryTrendDayDto, SectionCode } from '../../../shared/dto'

/** Chart-length section labels (the full titles live in the mastery panel above this one). */
const SECTION_META: { code: SectionCode; label: string; stroke: string; dotClass: string }[] = [
  { code: 'chem-phys', label: 'Chem & Phys', stroke: '#2563eb', dotClass: 'bg-blue-600' },
  { code: 'bio-biochem', label: 'Bio & Biochem', stroke: '#059669', dotClass: 'bg-emerald-600' },
  { code: 'psych-soc', label: 'Psych & Soc', stroke: '#7c3aed', dotClass: 'bg-violet-600' }
]

/** Chart-space coordinates: x spans 0..100, y leaves 2 units of head/footroom in a 48-unit box. */
const H = 48
const yOf = (v: number): number => H - 2 - v * (H - 4)
const xOf = (i: number, n: number): number => (n === 1 ? 50 : (i / (n - 1)) * 100)

/** Split a section's day series into segments of consecutive scored days (nulls = gaps). */
function segments(trend: MasteryTrendDayDto[], code: SectionCode): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = []
  let cur: { x: number; y: number }[] = []
  trend.forEach((d, i) => {
    const v = d.sections[code]
    if (v == null) {
      if (cur.length > 0) out.push(cur)
      cur = []
      return
    }
    cur.push({ x: xOf(i, trend.length), y: yOf(v) })
  })
  if (cur.length > 0) out.push(cur)
  return out
}

export function MasteryTrendPanel({ trend }: { trend: MasteryTrendDayDto[] }): React.JSX.Element {
  const bySection = useMemo(
    () => SECTION_META.map((meta) => ({ meta, segments: segments(trend, meta.code) })),
    [trend]
  )
  const hasAny = bySection.some((s) => s.segments.length > 0)

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Mastery over time</h3>
      <p className="mb-4 text-sm text-gray-500">
        Each day recomputed as of that day&rsquo;s end — the line moves when your evidence moved.
        Gaps mean a section didn&rsquo;t have enough data yet to score honestly.
      </p>
      {!hasAny ? (
        <p className="rounded-lg bg-gray-50 p-4 text-gray-500">
          The trend starts once a section has enough evidence to score — a handful of questions gets
          the first line on the board.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex h-40 flex-col justify-between py-0.5 text-right text-[10px] text-gray-300">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
            <svg
              viewBox={`0 0 100 ${H}`}
              preserveAspectRatio="none"
              className="h-40 flex-1"
              role="img"
              aria-label="Mastery over time per section"
            >
              {[0.25, 0.5, 0.75].map((g) => (
                <line key={g} x1="0" x2="100" y1={yOf(g)} y2={yOf(g)} stroke="#f3f4f6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {bySection.map(({ meta, segments: segs }) =>
                segs.map((seg, i) =>
                  seg.length === 1 ? (
                    <circle key={`${meta.code}-${i}`} cx={seg[0]!.x} cy={seg[0]!.y} r="1.5" fill={meta.stroke} />
                  ) : (
                    <polyline
                      key={`${meta.code}-${i}`}
                      points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke={meta.stroke}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                )
              )}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-4">
              {bySection.map(({ meta }) => {
                const latest = [...trend].reverse().find((d) => d.sections[meta.code] != null)
                const v = latest?.sections[meta.code]
                return (
                  <span key={meta.code} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                    {meta.label}
                    <span className="font-semibold text-gray-800">
                      {v == null ? '· needs data' : `${Math.round(v * 100)}%`}
                    </span>
                  </span>
                )
              })}
            </div>
            {trend.length > 1 && (
              <span className="text-[10px] text-gray-300">
                {trend[0]!.day} → {trend[trend.length - 1]!.day}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
