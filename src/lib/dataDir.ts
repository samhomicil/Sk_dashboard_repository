import { join } from 'path'

// Cache builds normally read the repo's data/ directory. The ingest-refresh
// endpoint overlays freshly fetched files into a temp dir and points
// SK_DATA_DIR at it for the duration of the rebuild — so this must be
// resolved at call time, never captured in a module-level constant.
export function dataPath(file: string): string {
  return join(process.env.SK_DATA_DIR ?? join(process.cwd(), 'data'), file)
}
