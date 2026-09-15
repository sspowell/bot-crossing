/**
 * Harness adapter: Business Tasks — not a coding harness at all.
 *
 * Sherman's CEO/content system (Claude, in a separate chat session) hands off actionable items
 * here the same way a coding agent hands off a thread: something exists, it needs a human, and
 * clicking it should take you straight to where you act on it. `data/business-tasks.json` is
 * that hand-off point — a small hand-edited (or Claude-edited) file, read-only from this side,
 * exactly like a harness's own session records.
 *
 * Each task becomes one astronaut, in a zone named by its own `project` field — "Business
 * Tasks" when a task doesn't set one, so existing files keep working unchanged. Different
 * arenas of life (content, a second business, personal errands) are just different `project`
 * values; each one gets its own zone the same way a real repo does, no code change needed.
 * `unread: true` is what gives it the "?" — a task nobody has captured yet reads as unanswered,
 * which is the truth. `lastActivityAt` is pinned to when the task was added rather than
 * refreshed on every scan, so a task that sits uncaptured drifts toward the colony's own
 * "asleep for a while" look instead of pretending to be freshly active — a task you're ignoring
 * should look ignored.
 *
 * Its building also grows with how much it wants you, not with effort spent — see
 * `urgencySize()` below. An optional `priority` field (`low` / `normal` / `high` / `urgent`,
 * defaulting to `normal`) sets how big it starts; simply sitting there does the rest, so an
 * ordinary task neglected for a few weeks ends up looking exactly as impossible to miss as
 * one you marked urgent on day one.
 *
 * Read-only, no subprocess: see the ground rules in `server/harnesses/README.md`. This adapter
 * never writes `data/business-tasks.json` — there is no delete route. `"done": true` marks a
 * task finished; `"deleted": true` marks it withdrawn instead of finished. Both just drop the
 * task out of `scanThreads()`; neither ever removes the entry from the file. Editing the file
 * by hand (or asking Claude to) is the only way in or out, same as `newSession()` below says.
 *
 * Change history: unlike the rest of `data/`, this one file is tracked in git (see the
 * exception in `.gitignore`) rather than left as untracked local state — it is hand-authored
 * content with no other backup anywhere, not colony bookkeeping the app can regenerate.
 * Whoever edits it (this includes a live Claude session doing it on Sherman's behalf) should
 * commit the change, so `git log -p data/business-tasks.json` is a real changelog: every task
 * added, decided, or withdrawn, in order, with a diff and a timestamp.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { exists } from '../lib/fsutil.mjs'

const TASKS_FILE = process.env.BOT_CROSSING_BUSINESS_TASKS || path.join(process.cwd(), 'data', 'business-tasks.json')

/** Prefixed, per the contract in `server/harnesses/README.md`. */
const ID = (raw) => `business:${raw}`

/**
 * Elsewhere in the colony `sizeBytes` is a real transcript length, and the building it grows
 * is a record of effort already spent. A hand-off task has no transcript, so this harness is
 * free to spend that same number on a more useful signal for a to-do list: how much it wants
 * you, growing with both an assigned `priority` and with plain neglect. `unread` already never
 * clears itself here, so a task nobody has acted on does not just sit — it visibly swells.
 *
 * The colony reads `sizeBytes` on a log scale (`transcriptProgress` in `src/game/colony.js`),
 * so moving the needle takes orders of magnitude, not percentages — hence the multipliers below
 * rather than anything additive.
 */
const PRIORITY_WEIGHT = { low: 0.5, normal: 1, high: 6, urgent: 25 }
/** One week of being ignored is worth one more decade of size, capped at three (~1000x). */
const NEGLECT_DECADE_DAYS = 7
const NEGLECT_CAP_DECADES = 3

function urgencySize(task, addedAt) {
  const base = 400 + String(task.preview || '').length * 20
  const weight = PRIORITY_WEIGHT[String(task.priority || 'normal').toLowerCase()] ?? PRIORITY_WEIGHT.normal
  const ageDays = Math.max(0, (Date.now() - addedAt) / 86_400_000)
  const neglect = 10 ** Math.min(ageDays / NEGLECT_DECADE_DAYS, NEGLECT_CAP_DECADES)
  return Math.round(base * weight * neglect)
}

async function scanThreads() {
  let raw
  try {
    raw = await fsp.readFile(TASKS_FILE, 'utf8')
  } catch {
    return []
  }

  let tasks
  try {
    tasks = JSON.parse(raw)
  } catch {
    // Being hand-edited mid-save is a normal thing to trip over — skip this pass, not the harness.
    return []
  }
  if (!Array.isArray(tasks)) return []

  const threads = []
  for (const task of tasks) {
    try {
      if (!task || typeof task !== 'object' || !task.id || task.done || task.deleted) continue
      const addedAt = Date.parse(task.addedAt) || Date.now()
      threads.push({
        id: ID(task.id),
        title: String(task.title || 'Untitled task'),
        preview: String(task.preview || ''),
        project: String(task.project || 'Business Tasks'),
        projectPath: '',
        worktree: '',
        cwd: '',
        gitBranch: '',
        model: String(task.category || ''),
        effort: '',
        createdAt: addedAt,
        lastActivityAt: addedAt,
        lastFocusedAt: 0,
        unread: true,
        running: false,
        hasError: false,
        starred: false,
        routine: false,
        prState: '',
        archived: false,
        sizeBytes: urgencySize(task, addedAt),
        source: 'manual',
        canOpen: Boolean(task.url),
        ref: { url: task.url || '' },
      })
    } catch {
      // One malformed task costs itself, not the rest of the list.
    }
  }
  return threads
}

/** The URL is all this adapter ever hands back — `present()` on the server opens it generically. */
function openThread(ref) {
  if (!ref?.url) return { ok: false, error: 'This task has no page to open.' }
  return { ok: true, url: ref.url }
}

function newSession() {
  return {
    ok: false,
    error:
      'Business tasks are managed by editing data/business-tasks.json directly — add one, set "done": true, or set "deleted": true to withdraw one. Nothing is ever removed from the file.',
  }
}

const detect = () => exists(TASKS_FILE)

export default {
  id: 'business-tasks',
  name: 'Business Tasks',
  detect,
  scanThreads,
  openThread,
  newSession,
  paths: { TASKS_FILE },
}
