/** The one stat tile. Home and Stats both render these — a visual tweak lands here once. */
export function StatTile({
  label,
  value,
  sub,
  children
}: {
  label: string
  value: string
  sub?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      {value !== '' && <p className="mt-0.5 text-2xl font-bold text-gray-800">{value}</p>}
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {children}
    </div>
  )
}
