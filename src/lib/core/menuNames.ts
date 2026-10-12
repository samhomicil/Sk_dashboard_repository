/**
 * Brink item names, one spelling everywhere. Brink writes the cup size into the name and
 * keeps several spellings of the same drink ("Hulk_Straw** 32 FUF", "Hulk_Straw*** 20"), so
 * every screen that names items reads them through here: Menu Mix and the Now screen agree.
 */

const SIZE = /^(.*?)\s*-?\s*\b(12|20|32|44)(\s*FUF)?$/i
const clean = (raw: string) => raw.replace(/\*/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The drink without its cup: "Angel Food 32 FUF" -> "Angel Food", "Hulk_Straw** 20" ->
 * "Hulk Straw", "Lil'_Angel" -> "Lil' Angel", "Flatbread Chicken" unchanged. Free Upsize
 * Friday (FUF) cups and the asterisk variants are the same drink, so they share a name.
 */
export function itemFamily(raw: string): string {
  const s = clean(raw)
  const m = s.match(SIZE)
  return m && m[1] ? m[1].trim() : s
}

/**
 * Menu Mix's naming, size first: "Angel Food 20" -> "20OZ - Angel Food",
 * "Hulk_Straw** 32 FUF" -> "32OZ - Hulk Straw", "Lil'_Angel" (a kids' cup) -> "KIDS - Lil' Angel".
 * parseSize / parseFlavor (menuMixUtils) then read the size and flavor back out.
 */
export function displayName(raw: string, kids: boolean): string {
  const s = clean(raw)
  const m = s.match(SIZE)
  const base = m && m[1] ? m[1].trim() : s
  if (kids) return `KIDS - ${base}`
  return m && m[1] ? `${m[2]}OZ - ${base}` : s
}
