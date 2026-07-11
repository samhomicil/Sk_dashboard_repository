import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import type { DaypartPayload, DaypartRow, WeekdayRow, DaypartCategoryRow, DaypartProductRow, EeRow } from './menuMixUtils'
export type { DaypartPayload }

const PATH = join(process.cwd(), 'data', 'menu-mix-daypart.json')

interface DaypartFile {
  refreshedAt: string; windowStart: string; windowEnd: string
  daypart:    Record<string, DaypartRow[]>
  weekday:    Record<string, WeekdayRow[]>
  categories: Record<string, Record<string, DaypartCategoryRow[]>>
  products:   Record<string, Record<string, DaypartProductRow[]>>
  ee:         Record<string, EeRow[]>
}

let _cache: DaypartFile | null = null
let _cacheAt = 0

function load(): DaypartFile | null {
  if (!existsSync(PATH)) return null
  const mtime = statSync(PATH).mtimeMs
  if (_cache && _cacheAt === mtime) return _cache
  _cache   = JSON.parse(readFileSync(PATH, 'utf-8')) as DaypartFile
  _cacheAt = mtime
  return _cache
}

export function getMenuMixDaypart(store: string): DaypartPayload | null {
  const d = load()
  if (!d) return null
  const key = d.daypart[store] ? store : 'all'
  const payload: DaypartPayload = {
    refreshedAt: d.refreshedAt,
    windowStart: d.windowStart,
    windowEnd:   d.windowEnd,
    daypart:     d.daypart[key] ?? [],
    weekday:     d.weekday[key] ?? [],
    categories:  d.categories?.[key] ?? {},
    products:    d.products?.[key] ?? {},
    ee:          d.ee?.[key] ?? [],
  }
  if (key === 'all') {
    payload.weekdayByStore = {
      pines:   d.weekday.pines   ?? [],
      miramar: d.weekday.miramar ?? [],
      margate: d.weekday.margate ?? [],
    }
    payload.eeByStore = {
      pines:   d.ee?.pines   ?? [],
      miramar: d.ee?.miramar ?? [],
      margate: d.ee?.margate ?? [],
    }
  }
  return payload
}
