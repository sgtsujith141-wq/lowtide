/** Collision-resistant, sortable-enough ids that work offline and in tests. */
export function newId(prefix = 'x'): string {
  const time = Date.now().toString(36)
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}_${time}${rand}`
}
