/**
 * Harness adapter: TickTick — the colony as a live picture of a to-do account.
 *
 * Every TickTick list is a zone, every open task on it is an astronaut. Nothing here knows
 * anything about coding agents; it just speaks the Thread shape from `server/harnesses/README.md`
 * and the rest of the app does the drawing.
 *
 * How a task behaves is decided by its due date, mapped onto states the colony already has:
 *
 *   overdue        → `hasError`  → blocked: slumped, red eyes, a `!`
 *   due today      → `unread`    → waiting: stopped, bobbing a `?`
 *   anything else  → idle, pottering about its plot
 *
 * Priority doesn't get a state of its own — it gets size. High-priority tasks hint an `urgency`
 * that lets their building grow into the tall recipes (see `buildingUrgency` in
 * `src/game/colony.js`), so the important ones stand out even when they aren't due yet.
 *
 * Idle tasks report `lastActivityAt` as scan time rather than their real edit time. A to-do item
 * nobody touched for three days isn't dormant, it's just waiting its turn — and letting it age
 * would fold whole lists off the map under the "hide dormant repos" setting. Overdue and
 * due-today tasks keep their real modified time, so "mark viewed" sticks until the task changes
 * and their buildings keep growing with neglect.
 *
 * Read-only by default. The one write it can make — completing a task, from the galaxy view —
 * only works when the saved token was granted `tasks:write` (`node scripts/ticktick-auth.mjs
 * --write`); with a read-only token every thread reports `canResolve: false` and
 * `completeThread` refuses. The token lives in `data/ticktick-token.json` (gitignored) and never
 * leaves this process — nothing in a Thread, including `ref`, carries it to the browser.
 *
 * The API is polled at most every 25 seconds no matter how many tabs are open; a failed fetch keeps
 * showing the last good picture and reports why through `diagnostic()`.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists } from '../lib/fsutil.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE =
  process.env.BOT_CROSSING_TICKTICK_TOKEN || path.join(here, '..', '..', 'data', 'ticktick-token.json')

const API = 'https://api.ticktick.com/open/v1'
const CACHE_MS = 25_000
const TIMEOUT_MS = 10_000
const DAY_MS = 86_400_000

/** TickTick's own numbers: 0 none, 1 low, 3 medium, 5 high. */
const PRIORITY_LABEL = { 0: '', 1: 'Low priority', 3: 'Medium priority', 5: 'High priority' }
const PRIORITY_URGENCY = { 0: 0, 1: 0, 3: 0.4, 5: 0.8 }

const ID = (raw) => `ticktick:${raw}`

/** `2026-09-14T04:00:00.000+0000` — the offset has no colon, which not every parser accepts. */
export function parseDate(value) {
  if (!value) return 0
  const t = Date.parse(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(t) ? 0 : t
}

/**
 * Where a task sits against the clock. "Today" is this machine's local calendar day, which is
 * the owner's day — the server only runs on their own computer.
 *
 * An all-day task is due for the whole of its day, so it isn't overdue until that day ends.
 */
export function dueState(task, now = Date.now()) {
  const due = parseDate(task.dueDate)
  if (!due) return 'none'
  const deadline = task.isAllDay ? due + DAY_MS : due
  if (deadline <= now) return 'overdue'
  const d = new Date(due)
  const n = new Date(now)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? 'today' : 'later'
}

function dueLabel(task, state) {
  if (state === 'overdue') {
    const day = new Date(parseDate(task.dueDate)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `Overdue since ${day}`
  }
  if (state === 'today') return 'Due today'
  if (state === 'later') {
    return `Due ${new Date(parseDate(task.dueDate)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }
  return ''
}

/** One TickTick task → one Thread. Exported so the mapping can be tested without the network. */
export function toThread(task, listName, now = Date.now(), { writable = false } = {}) {
  const state = dueState(task, now)
  const urgent = state === 'overdue' || state === 'today'
  const touched = parseDate(task.modifiedTime) || parseDate(task.createdTime) || now
  const priority = Number(task.priority) || 0
  const notes = String(task.content || task.desc || '').replace(/\s+/g, ' ').trim()
  const projectId = task.projectId || ''

  return {
    id: ID(task.id),
    title: String(task.title || 'Untitled task').slice(0, 160),
    preview: notes.slice(0, 240),
    project: listName,
    projectPath: '',
    worktree: '',
    cwd: '',
    gitBranch: '',
    model: dueLabel(task, state),
    effort: PRIORITY_LABEL[priority] ?? '',
    createdAt: parseDate(task.createdTime) || touched,
    lastActivityAt: urgent ? touched : now,
    lastFocusedAt: 0,
    unread: state === 'today',
    running: false,
    hasError: state === 'overdue',
    starred: priority === 5,
    routine: '',
    prState: '',
    archived: false,
    // The card's progress bar reads this on a log scale — let priority move it visibly.
    sizeBytes: 2000 * 10 ** (priority / 2),
    urgency: PRIORITY_URGENCY[priority] ?? 0,
    source: 'ticktick',
    tags: Array.isArray(task.tags) ? task.tags.map((t) => String(t).toLowerCase()) : [],
    // Numbers the galaxy can do arithmetic on, rather than re-parsing labels.
    dueAt: parseDate(task.dueDate),
    overdueDays: state === 'overdue' ? Math.max(0, (now - (parseDate(task.dueDate) + (task.isAllDay ? DAY_MS : 0))) / DAY_MS) : 0,
    // Checklist sub-steps — the galaxy draws them as moons, so a task hiding eight steps looks it.
    items: (Array.isArray(task.items) ? task.items : [])
      .slice(0, 24)
      .map((it) => ({ title: String(it?.title || '').slice(0, 120), done: Number(it?.status) === 1 })),
    listId: projectId,
    canOpen: Boolean(task.id && projectId),
    canResolve: Boolean(writable && task.id && projectId),
    ref: {
      url: task.id && projectId ? `https://ticktick.com/webapp/#p/${projectId}/tasks/${task.id}` : '',
      projectId,
      taskId: task.id || '',
    },
  }
}

async function readAuth() {
  try {
    const saved = JSON.parse(await fsp.readFile(TOKEN_FILE, 'utf8'))
    const token = typeof saved.access_token === 'string' ? saved.access_token : ''
    return { token, writable: String(saved.scope || '').split(/\s+/).includes('tasks:write') }
  } catch {
    return { token: '', writable: false }
  }
}

async function call(token, pathname, { method = 'GET', body } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 401) {
    throw new Error('TickTick rejected the saved token — run `node scripts/ticktick-auth.mjs` again')
  }
  if (res.status === 403) throw new Error('This TickTick login is read-only — run `node scripts/ticktick-auth.mjs --write`')
  if (!res.ok) throw new Error(`TickTick answered ${res.status} for ${pathname}`)
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

const get = (token, pathname) => call(token, pathname)

async function fetchThreads(token, writable) {
  const now = Date.now()
  const projects = await get(token, '/project')
  // Note lists hold notes, not to-dos; closed lists are archived in TickTick's own UI.
  const lists = (Array.isArray(projects) ? projects : []).filter((p) => p && p.id && !p.closed && p.kind !== 'NOTE')

  const threads = []
  // The Inbox isn't in the project list; it has its own id. If an account's Inbox can't be
  // read this way, skip it rather than losing every other list over it.
  const inbox = await get(token, '/project/inbox/data').catch(() => null)
  for (const task of inbox?.tasks || []) {
    if (task && task.id && task.status !== 2) threads.push(toThread(task, 'Inbox', now, { writable }))
  }

  for (const list of lists) {
    const data = await get(token, `/project/${encodeURIComponent(list.id)}/data`)
    const name = String(list.name || 'Untitled list')
    for (const task of data?.tasks || []) {
      if (task && task.id && task.status !== 2) threads.push(toThread(task, name, now, { writable }))
    }
  }
  return threads
}

let cache = { at: 0, threads: [] }
let inflight = null
let lastError = ''

async function refresh() {
  const { token, writable } = await readAuth()
  if (!token) {
    lastError = 'No TickTick token yet — run `node scripts/ticktick-auth.mjs`'
    return cache.threads
  }
  try {
    const threads = await fetchThreads(token, writable)
    cache = { at: Date.now(), threads }
    lastError = ''
    return threads
  } catch (err) {
    // Keep the last good picture on screen, and don't retry until the next cache window.
    cache = { ...cache, at: Date.now() }
    lastError = err?.message || 'Could not reach TickTick'
    return cache.threads
  }
}

async function scanThreads() {
  if (cache.at && Date.now() - cache.at < CACHE_MS) return cache.threads
  inflight ??= refresh().finally(() => {
    inflight = null
  })
  return inflight
}

function openThread(ref) {
  if (!ref?.url) return { ok: false, error: 'This task has no TickTick link to open.' }
  return { ok: true, url: ref.url }
}

function newSession() {
  return { ok: false, error: 'Add tasks in TickTick itself — they appear here within a minute.' }
}

/**
 * The one write this adapter makes: marking a task complete, because the person looking at it
 * clicked "Resolve". Never called on anyone's behalf by the scan. The ids come from `ref`, which
 * this adapter built, and are shape-checked before going anywhere near a URL.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

async function completeThread(ref) {
  const projectId = String(ref?.projectId || '')
  const taskId = String(ref?.taskId || '')
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(taskId)) return { ok: false, error: 'That task reference is malformed.' }

  const { token, writable } = await readAuth()
  if (!token) return { ok: false, error: 'No TickTick login yet.' }
  if (!writable) return { ok: false, error: 'This TickTick login is read-only — run `node scripts/ticktick-auth.mjs --write`.' }

  try {
    await call(token, `/project/${projectId}/task/${taskId}/complete`, { method: 'POST' })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  // Drop it from the cached picture now rather than waiting out the minute, so the thought is
  // gone on the very next poll instead of reappearing after it dissolved.
  const id = ID(taskId)
  cache = { ...cache, threads: cache.threads.filter((t) => t.id !== id) }
  return { ok: true }
}

async function writableToken() {
  const { token, writable } = await readAuth()
  if (!token) return { error: 'No TickTick login yet.' }
  if (!writable) return { error: 'This TickTick login is read-only — run `node scripts/ticktick-auth.mjs --write`.' }
  return { token }
}

/**
 * A new thought, typed into the galaxy. Lands in the given list, or the Inbox without one.
 * Validated before anything touches the network: a title is plain text with a length cap, and a
 * list id has the same shape check as everywhere else.
 */
async function createThread({ title, listId } = {}) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!clean) return { ok: false, error: 'A thought needs a few words.' }
  const list = listId ? String(listId) : ''
  if (list && !SAFE_ID.test(list)) return { ok: false, error: 'That list reference is malformed.' }

  const auth = await writableToken()
  if (auth.error) return { ok: false, error: auth.error }
  try {
    const task = await call(auth.token, '/task', { method: 'POST', body: list ? { title: clean, projectId: list } : { title: clean } })
    cache = { ...cache, at: 0 } // show it on the very next poll
    return { ok: true, id: task?.id ? ID(task.id) : '' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Move a thought to a different list, via `POST /task/move`. Worth knowing: sending a new
 * `projectId` through the ordinary update endpoint returns 200 and moves *nothing* — verified
 * against a real account. So this reads the task back from the target list afterwards instead of
 * trusting the status code; a silent no-op would leave the galaxy showing a move that never
 * happened.
 */
async function moveThread(ref, toListId) {
  const from = String(ref?.projectId || '')
  const taskId = String(ref?.taskId || '')
  const to = String(toListId || '')
  if (![from, taskId, to].every((v) => SAFE_ID.test(v))) return { ok: false, error: 'That task or list reference is malformed.' }
  if (from === to) return { ok: true }

  const auth = await writableToken()
  if (auth.error) return { ok: false, error: auth.error }
  try {
    await call(auth.token, '/task/move', { method: 'POST', body: [{ fromProjectId: from, toProjectId: to, taskId }] })
    const landed = await call(auth.token, `/project/${to}/task/${taskId}`).catch(() => null)
    cache = { ...cache, at: 0 }
    if (!landed?.id) return { ok: false, error: "TickTick accepted the change but didn't move the task." }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const detect = () => exists(TOKEN_FILE)
const diagnostic = async () => lastError

export default {
  id: 'ticktick',
  name: 'TickTick',
  detect,
  scanThreads,
  openThread,
  newSession,
  completeThread,
  createThread,
  moveThread,
  diagnostic,
  paths: { TOKEN_FILE },
}
