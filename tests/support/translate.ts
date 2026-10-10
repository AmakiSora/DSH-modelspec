/**
 * Test double of the locale lookup chain: a translate stub over plain
 * dictionaries, mirroring the host LocaleRuntime's resolution order (the first
 * dictionary that owns the key wins, then the key itself stays visible) and its
 * `{name}` template interpolation.
 *
 * This lives here rather than coming from `@deepseek-ai/dsh-client-test-runtime`
 * because that package's published artifact imports a monorepo source path it
 * does not ship, so it cannot be resolved from an installed copy.
 */

/**
 * Build a translate stub resolving through `dicts` in order, falling back to the key.
 * @param dicts - dictionaries consulted in order.
 * @returns the translate function, assignable to the page's `t` seat.
 */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}
