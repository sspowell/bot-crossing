/**
 * The harness registry.
 *
 * Adding support for another agent harness means writing one module next to this file and
 * adding it to the list below. Nothing else in the codebase needs to change — the scanner,
 * the API and the browser all talk to harnesses only through the interface documented in
 * `server/harnesses/README.md`.
 */
import claudeCode from './claude-code.mjs'
import codex from './codex.mjs'
import cursor from './cursor.mjs'
import businessTasks from './business-tasks.mjs'
import ticktick from './ticktick.mjs'

const ALL = [claudeCode, codex, cursor, businessTasks, ticktick]

/**
 * Which of them the colony actually shows. This install is a picture of a TickTick account,
 * so that's the default; the coding-agent harnesses are all still here, just switched off.
 * Bring any back with a comma-separated list of ids, e.g.
 *
 *   BOT_CROSSING_HARNESSES=ticktick,claude-code
 */
const ENABLED = (process.env.BOT_CROSSING_HARNESSES || 'ticktick')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

export const HARNESSES = ALL.filter((h) => ENABLED.includes(h.id))

export const harnessById = (id) => HARNESSES.find((h) => h.id === id) || null

/**
 * Which harnesses have data on this machine. Detection is per-scan rather than cached at
 * boot so that installing one while the colony is running is picked up on the next poll.
 */
export async function detectedHarnesses() {
  const flags = await Promise.all(
    HARNESSES.map(async (h) => {
      try {
        return await h.detect()
      } catch {
        return false
      }
    })
  )
  return HARNESSES.filter((_, i) => flags[i])
}
