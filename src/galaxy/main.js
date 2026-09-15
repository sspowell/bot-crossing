/**
 * Thought Galaxy — the front door.
 *
 * Same bones as the colony: the server, the TickTick adapter, `/api/threads`, the colony state
 * file. Only the picture changed. This file wires them together: fetch the thoughts, place them,
 * handle your hands, and save wherever you pull something to.
 */
import './styles.css'
import * as THREE from 'three'
import { createScene } from './scene.js'
import { createWeb, stateOf } from './web.js'
import { createUi, FILTERS } from './ui.js'
import { placeNode, thoughtOffset, phaseOf, hueOf } from './layout.js'
import { fetchThreads, fetchState, saveState, openThread } from '../game/api.js'

const POLL_MS = 12_000
const DRAG_THRESHOLD = 5
/** After this long with no input, the sky keeps drifting at 30fps instead of full speed. */
const IDLE_AFTER_MS = 15_000

const root = document.getElementById('galaxy')
const stage = createScene(root)
const web = createWeb(stage)

let state = { galaxy: {} }
let stateLoaded = false
let threads = []
let selected = null
let focusNode = null
let filterId = 'all'
/** One-thought-at-a-time mode: a queue of the loudest thoughts and where we are in it. */
let focus = null

const post = async (url, payload) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
  return body
}

/** The list id behind a node, read off any thought that lives in it. */
const listIdOf = (nodeName) => threads.find((t) => t.project === nodeName && t.listId)?.listId || ''
const writable = () => threads.some((t) => t.canResolve)

// ── actions ─────────────────────────────────────────────────────────────────────────
const actions = {
  filter(id) {
    if (focus) return
    filterId = filterId === id && id !== 'all' ? 'all' : id
    applyFilter()
  },

  focusNode(name) {
    if (focus) return
    focusNode = name
    web.setFocusNode(name)
    ui.fillPanel(web, name)
    stage.setViewShift(170)
    const node = web.nodes.get(name)
    if (node) stage.flyTo(node.pos.clone(), 95)
    if (selected && web.thoughts.get(selected)?.node !== name) actions.close()
  },

  unfocus({ fly = true } = {}) {
    focusNode = null
    web.setFocusNode(null)
    ui.fillPanel(web, null)
    stage.setViewShift(0)
    actions.close()
    if (fly) stage.flyTo(new THREE.Vector3(0, 0, 0), 270)
  },

  selectThought(id) {
    const t = web.thoughts.get(id)
    if (!t) return
    selected = id
    web.setSelected(id)
    ui.fillCard(web, id)
    stage.flyTo(t.world.clone(), 45)
  },

  close() {
    selected = null
    web.setSelected(null)
    ui.card.hidden = true
  },

  /** The card's ×: in focus mode that means "I'm done focusing", not "show me an empty sky". */
  dismiss() {
    if (focus) actions.exitFocus()
    else actions.close()
  },

  async open() {
    const t = web.thoughts.get(selected)
    if (!t) return
    try {
      await openThread(t.thread)
      ui.toast('Opened in TickTick')
    } catch (err) {
      ui.toast(err.message || 'Could not open that', 'err')
    }
  },

  async resolve() {
    const t = web.thoughts.get(selected)
    if (!t?.thread.canResolve) return
    const { id, thread } = t
    actions.close()
    web.dissolve(id)
    try {
      await post('/api/complete', { harness: thread.harness, ref: thread.ref })
      threads = threads.filter((x) => x.id !== id)
      ui.toast(`Resolved — “${thread.title}”`)
      refreshUi()
      if (focus) {
        focus.queue = focus.queue.filter((q) => q !== id)
        if (!focus.queue.length) {
          actions.exitFocus()
          ui.toast('The web is calm — nothing tangled or asking.')
        } else {
          focus.index %= focus.queue.length
          setTimeout(showFocused, 1100)
        }
      }
    } catch (err) {
      ui.toast(err.message, 'err')
      // It still exists in TickTick, so the next poll brings it back.
      setTimeout(poll, 400)
    }
  },

  // One thought at a time — the loudest first: most overdue, then due today, heavier before lighter.
  enterFocus() {
    if (focus) return actions.exitFocus()
    const queue = [...web.thoughts.values()]
      .filter((t) => t.state !== 'drifting' && !t.leaving && t.dissolving === null)
      .sort((a, b) =>
        a.state === b.state
          ? (Number(b.thread.overdueDays) || 0) - (Number(a.thread.overdueDays) || 0) ||
            (Number(b.thread.urgency) || 0) - (Number(a.thread.urgency) || 0)
          : a.state === 'tangled'
            ? -1
            : 1
      )
      .map((t) => t.id)
    if (!queue.length) return ui.toast('Nothing tangled or asking. The web is calm.')
    if (focusNode) actions.unfocus({ fly: false })
    ui.toggleSettings(false)
    focus = { queue, index: 0 }
    showFocused()
  },

  skipFocus() {
    if (!focus) return
    focus.index = (focus.index + 1) % focus.queue.length
    showFocused()
  },

  exitFocus() {
    if (!focus) return
    focus = null
    ui.setFocus(null)
    actions.close()
    applyFilter()
    stage.flyTo(new THREE.Vector3(0, 0, 0), 270)
  },

  openCapture() {
    if (!writable()) return ui.toast('Capturing is off — run the TickTick login with --write.', 'err')
    const lists = [...new Set(threads.map((t) => t.project))]
      .map((name) => ({ name, id: listIdOf(name) }))
      .filter((l) => l.id)
      .sort((a, b) => a.name.localeCompare(b.name))
    ui.openCapture(lists, focusNode)
  },

  async submitCapture(title, listId, nodeName) {
    web.birth(nodeName)
    try {
      await post('/api/create', { harness: 'ticktick', title, listId })
      ui.toast(`Released into ${nodeName || 'your Inbox'}`)
      setTimeout(poll, 700)
    } catch (err) {
      ui.toast(err.message, 'err')
    }
  },

  toggleSettings() {
    ui.toggleSettings()
  },

  setSetting(name, value) {
    if (name === 'bloom') quality.bloom = value === 'on'
    if (name === 'detail' && DETAIL_RATIO[value]) quality.detail = value
    applyQuality()
    try {
      localStorage.setItem(QUALITY_KEY, JSON.stringify(quality))
    } catch {}
  },
}

const ui = createUi(root, actions)

function showFocused() {
  if (!focus) return
  // Anything resolved or moved away since the queue was built drops out here.
  focus.queue = focus.queue.filter((id) => web.thoughts.has(id))
  if (!focus.queue.length) return actions.exitFocus()
  focus.index %= focus.queue.length
  const id = focus.queue[focus.index]
  web.setFilter((t) => t.id === id)
  ui.setFocus({ index: focus.index, total: focus.queue.length })
  actions.selectThought(id)
}

// ── display quality ─────────────────────────────────────────────────────────────────
const QUALITY_KEY = 'galaxy-quality'
const DETAIL_RATIO = { low: 1, balanced: 1.5, high: 2 }
let quality = { bloom: true, detail: innerWidth < 760 ? 'balanced' : 'high' }
try {
  quality = { ...quality, ...JSON.parse(localStorage.getItem(QUALITY_KEY) || '{}') }
} catch {}
function applyQuality() {
  stage.setQuality({ bloom: quality.bloom, pixelRatio: DETAIL_RATIO[quality.detail] || 2 })
  ui.setSettings(quality)
}
applyQuality()

// ── data ────────────────────────────────────────────────────────────────────────────
function apply(list) {
  threads = list.filter((t) => !t.archived)
  const galaxy = (state.galaxy ||= {})

  const names = [...new Set(threads.map((t) => t.project || 'Unsorted'))].sort()
  const taken = names.map((n) => galaxy[`node:${n}`]).filter(Array.isArray)
  let placedNew = false

  const nodeList = names.map((name) => {
    let pos = galaxy[`node:${name}`]
    if (!Array.isArray(pos)) {
      pos = placeNode(name, taken)
      taken.push(pos)
      if (stateLoaded) {
        galaxy[`node:${name}`] = pos
        placedNew = true
      }
    }
    return { name, pos, hue: hueOf(name) }
  })

  const thoughtList = threads.map((t) => ({
    id: t.id,
    thread: t,
    node: t.project || 'Unsorted',
    offset: Array.isArray(galaxy[`thought:${t.id}`]) ? galaxy[`thought:${t.id}`] : thoughtOffset(t.id),
    phase: phaseOf(t.id),
  }))

  web.setData({ nodeList, thoughtList })
  if (placedNew) queueSave()
  applyFilter()
  refreshUi()
}

function refreshUi() {
  const tangled = threads.filter((t) => stateOf(t) === 'tangled').length
  const asking = threads.filter((t) => stateOf(t) === 'asking').length
  ui.setMeter({ tangled, asking, total: threads.length })
  ui.setWritable(writable())
  ui.syncLabels(web)
  recordDay(tangled, asking, threads.length)
  if (focusNode) ui.fillPanel(web, focusNode)
  if (selected) {
    if (web.thoughts.has(selected) && threads.some((t) => t.id === selected)) ui.fillCard(web, selected)
    else actions.close()
  }
}

function applyFilter() {
  if (focus) return
  let test = FILTERS.find((f) => f.id === filterId)?.test || null
  if (filterId === 'woven') {
    const ids = new Set(web.tagLinks.flatMap((l) => [l.a, l.b]))
    test = (t) => ids.has(t.id)
  }
  web.setFilter(test)
  ui.setFilter(filterId)
}

/** One entry per local calendar day in colony state, holding that day's latest counts. */
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function recordDay(tangled, asking, total) {
  if (!stateLoaded) return
  const key = `day:${today()}`
  const value = [tangled, asking, total]
  if (JSON.stringify(state.galaxy[key]) !== JSON.stringify(value)) {
    state.galaxy[key] = value
    queueSave()
  }
  const days = Object.entries(state.galaxy)
    .filter(([k, v]) => k.startsWith('day:') && Array.isArray(v))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ date: k.slice(4), tangled: v[0], asking: v[1], total: v[2] }))
  ui.setHistory(days)
}

let polling = false
async function poll() {
  if (polling) return
  polling = true
  try {
    const res = await fetchThreads()
    apply(Array.isArray(res) ? res : res.threads || [])
  } catch (err) {
    ui.toast(`Lost the thread to the server — ${err.message}`, 'err')
  } finally {
    polling = false
  }
}

let saveTimer = 0
function queueSave() {
  if (!stateLoaded) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      state = await saveState(state)
    } catch {
      // Nothing local is lost; the next change tries again.
    }
  }, 700)
}

// ── hands ───────────────────────────────────────────────────────────────────────────
const canvas = stage.renderer.domElement
let press = null
let lastInput = performance.now()
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(ev, () => (lastInput = performance.now()), { passive: true })
}

// Capture phase on window, so a press that lands on a star is claimed before the orbit
// controls start rotating the sky.
addEventListener(
  'pointerdown',
  (e) => {
    if (e.target !== canvas || e.button !== 0) return
    ui.toggleSettings(false)
    const hit = web.pick(e.clientX, e.clientY)
    press = { x: e.clientX, y: e.clientY, hit, dragging: false, moved: false }
    if (hit) stage.controls.enabled = false
  },
  true
)

addEventListener('pointermove', (e) => {
  if (press) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) press.moved = true
    if (press.hit && press.moved) {
      if (!press.dragging) press.dragging = web.beginDrag(press.hit.kind, press.hit.id)
      const pos = web.dragTo(press.hit.kind, press.hit.id, e.clientX, e.clientY, stage.uniforms.uTime.value)
      if (pos) state.galaxy[`${press.hit.kind}:${press.hit.id}`] = pos
      canvas.className = 'g-canvas drag'
      ui.showTooltip(web, null)
      return
    }
  }
  if (e.target !== canvas) {
    web.setHover(null)
    ui.showTooltip(web, null)
    return
  }
  const h = web.pick(e.clientX, e.clientY)
  web.setHover(h)
  ui.showTooltip(web, h, e.clientX, e.clientY)
  canvas.className = h ? 'g-canvas point' : 'g-canvas grab'
})

addEventListener('pointerup', () => {
  if (!press) return
  const { hit, dragging, moved } = press
  press = null
  stage.controls.enabled = true
  if (dragging) {
    const target = web.endDrag(hit.kind, hit.id)
    if (target) return moveThought(hit.id, target)
    queueSave()
    ui.toast(hit.kind === 'node' ? 'Moved the whole cluster' : 'Pulled free — it stays where you left it')
    return
  }
  if (moved) return
  if (hit?.kind === 'thought') actions.selectThought(hit.id)
  else if (hit?.kind === 'node') actions.focusNode(hit.id)
  else if (selected && !focus) actions.close()
})

/** Dropped onto another node: move it into that list for real. */
async function moveThought(id, nodeName) {
  const t = web.thoughts.get(id)
  const to = listIdOf(nodeName)
  if (!t) return
  if (!t.thread.canResolve || !to) {
    ui.toast(t.thread.canResolve ? `Couldn't find ${nodeName} in TickTick` : 'Moving is off — run the TickTick login with --write.', 'err')
    delete state.galaxy[`thought:${id}`]
    return poll()
  }
  delete state.galaxy[`thought:${id}`]
  queueSave()
  web.reassign(id, nodeName, thoughtOffset(id))
  try {
    await post('/api/move', { harness: t.thread.harness, ref: t.thread.ref, to })
    ui.toast(`Moved “${t.thread.title}” to ${nodeName}`)
  } catch (err) {
    ui.toast(err.message, 'err')
  }
  setTimeout(poll, 500)
}

let cursor = -1
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return
  const key = e.key.toLowerCase()
  if (e.key === 'Escape') {
    if (ui.capturing) ui.closeCapture()
    else if (focus) actions.exitFocus()
    else if (selected) actions.close()
    else if (focusNode) actions.unfocus()
    ui.toggleSettings(false)
  } else if (key === 'n' && !focus) {
    // Tangled first, then asking — the loudest thing wins.
    const wants = [...web.thoughts.values()]
      .filter((t) => t.state !== 'drifting' && !t.leaving && t.dissolving === null)
      .sort((a, b) => (a.state === b.state ? a.node.localeCompare(b.node) || a.id.localeCompare(b.id) : a.state === 'tangled' ? -1 : 1))
    if (!wants.length) return ui.toast('Nothing tangled or asking. The web is calm.')
    cursor = (cursor + 1) % wants.length
    actions.selectThought(wants[cursor].id)
  } else if (key === 'f') {
    actions.enterFocus()
  } else if (key === 'c') {
    e.preventDefault()
    actions.openCapture()
  } else if (key === 'r' && !focus) {
    actions.unfocus()
  }
})

// Come back to the tab, see the present — don't wait out the poll.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && poll())
addEventListener('focus', () => poll())

// ── loop ────────────────────────────────────────────────────────────────────────────
let last = performance.now()
let pending = 0
let frames = 0
function tick(now) {
  pending += (now - last) / 1000
  last = now
  // Nobody touching it and nothing in motion: drift at 30fps instead of burning a full frame rate
  // on a screen left open.
  const idle = now - lastInput > IDLE_AFTER_MS && !stage.flying && !press && !focus
  if (idle && pending < 1 / 30) {
    requestAnimationFrame(tick)
    return
  }
  const dt = Math.min(0.05, pending)
  pending = 0
  web.update(dt, stage.uniforms.uTime.value)
  stage.render(dt)
  ui.placeLabels(web, focusNode)
  if (selected) ui.placeCard(web, selected)
  ui.frame(dt)
  if (++frames % 60 === 0) ui.syncLabels(web)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

// ── boot ────────────────────────────────────────────────────────────────────────────
Promise.allSettled([fetchState(), fetchThreads()]).then(([s, t]) => {
  if (s.status === 'fulfilled') {
    state = s.value
    state.galaxy ||= {}
    stateLoaded = true
  }
  if (t.status === 'fulfilled') apply(Array.isArray(t.value) ? t.value : t.value.threads || [])
  else ui.toast('Could not reach the server', 'err')
})
setInterval(poll, POLL_MS)
