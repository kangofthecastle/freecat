/** Level from lifetime XP: level N needs 100·N·(N-1)/2 XP cumulatively (100, 300, 600, …). */
export function levelForXp(xp: number): { level: number; into: number; toNext: number } {
  let level = 1
  let floor = 0
  while (xp >= floor + level * 100) { floor += level * 100; level++ }
  const span = level * 100
  return { level, into: xp - floor, toNext: span - (xp - floor) }
}
