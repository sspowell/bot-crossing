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

const POLL_MS = 20_000
const DRAG_THRESHOLD = 5

const root = document.getElementById('galaxy')
const stage = createScene(root)
const web = createWeb(stage)

let state = { galaxy: {} }
let stateLoaded = false
let threads = []
let selected = null
let focusNode = null
let filterId = 'all'

// ── actions ─────────────────────────────────────────────────────────────────────────
const actions = {
  filter(id) {
    filterId = filterId === id && id !== 'all' ? 'all' : id
    applyFilter()
  },

  focusNode(name) {
    focusNode = name
    web.setFocusNode(name)
    ui.fillPanel(web, name)
    stage.setViewShift(170)
    const node = web.nodes.get(name)
    if (node) stage.flyTo(node.pos.clone(), 95)
    if (selected && web.thoughts.get(selected)?.node !== name) actions.close()
  },

  unfocus() {
    focusNode = null
    web.setFocusNode(null)
    ui.fillPanel(web, null)
    stage.setViewShift(0)
    actions.close()
    stage.flyTo(new THREE.Vector3(0, 0, 0), 270)
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
      const res = await fetch('/api/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: thread.harness, ref: thread.ref }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not resolve that')
      threads = threads.filter((x) => x.id !== id)
      ui.toast(`Resolved — “${thread.title}”`)
      refreshUi()
    } catch (err) {
      ui.toast(err.message, 'err')
      // It still exists in TickTick, so the next poll brings it back.
      setTimeout(poll, 400)
    }
  },
}

const ui = createUi(root, actions)

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
  ui.syncLabels(web)
  if (focusNode) ui.fillPanel(web, focusNode)
  if (selected) {
    if (web.thoughts.has(selected) && threads.some((t) => t.id === selected)) ui.fillCard(web, selected)
    else actions.close()
  }
}

function applyFilter() {
  let test = FILTERS.find((f) => f.id === filterId)?.test || null
  if (filterId === 'woven') {
    const ids = new Set(web.tagLinks.flatMap((l) => [l.a, l.b]))
    test = (t) => ids.has(t.id)
  }
  web.setFilter(test)
  ui.setFilter(filterId)
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

// Capture phase on window, so a press that lands on a star is claimed before the orbit
// controls start rotating the sky.
addEventListener(
  'pointerdown',
  (e) => {
    if (e.target !== canvas || e.button !== 0) return
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
    web.endDrag(hit.kind, hit.id)
    queueSave()
    ui.toast(hit.kind === 'node' ? 'Moved the whole cluster' : 'Pulled free — it stays where you left it')
    return
  }
  if (moved) return
  if (hit?.kind === 'thought') actions.selectThought(hit.id)
  else if (hit?.kind === 'node') actions.focusNode(hit.id)
  else if (selected) actions.close()
})

let cursor = -1
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return
  if (e.key === 'Escape') {
    if (selected) actions.close()
    else if (focusNode) actions.unfocus()
  } else if (e.key === 'n' || e.key === 'N') {
    // Tangled first, then asking — the loudest thing wins.
    const wants = [...web.thoughts.values()]
      .filter((t) => t.state !== 'drifting' && !t.leaving && t.dissolving === null)
      .sort((a, b) => (a.state === b.state ? a.node.localeCompare(b.node) || a.id.localeCompare(b.id) : a.state === 'tangled' ? -1 : 1))
    if (!wants.length) return ui.toast('Nothing tangled or asking. The web is calm.')
    cursor = (cursor + 1) % wants.length
    actions.selectThought(wants[cursor].id)
  } else if (e.key === 'r' || e.key === 'R') {
    actions.unfocus()
  }
})

// ── loop ────────────────────────────────────────────────────────────────────────────
let last = performance.now()
let frames = 0
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
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
