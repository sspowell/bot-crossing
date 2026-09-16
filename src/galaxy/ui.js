/**
 * Everything drawn in HTML over the sky: the untangle meter, sun names, the card for a
 * selected world, the panel for a focused system, filters, and toasts.
 *
 * It only ever describes what the web already shows. If this layer and the stars disagree about
 * a task, that's a bug — both read the same `stateOf`.
 */
import { stateOf } from './solar.js'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STATE_WORD = { tangled: 'Tangled · falling sunward', asking: 'Asking for you', drifting: 'In orbit' }

export const FILTERS = [
  { id: 'all', label: 'Everything', test: null },
  { id: 'tangled', label: 'Tangled', test: (t) => t.state === 'tangled' },
  { id: 'asking', label: 'Asking', test: (t) => t.state === 'asking' },
  { id: 'heavy', label: 'Heavy', test: (t) => (Number(t.thread.urgency) || 0) >= 0.4 },
  { id: 'woven', label: 'Woven', test: null }, // set at runtime: thoughts on a cross-node thread
]

export function createUi(root, actions) {
  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="g-cursor" aria-hidden="true"></div>
    <header class="g-top">
      <div class="g-brand">
        <span class="g-mark">✦</span>
        <div>
          <div class="g-title">thought galaxy</div>
          <div class="g-sub">untangle the orbits</div>
        </div>
      </div>
      <div class="g-meter" role="group" aria-label="State of the web">
        <button class="g-stat tangled" data-filter="tangled"><b>0</b><span>tangled</span></button>
        <button class="g-stat asking" data-filter="asking"><b>0</b><span>asking</span></button>
        <button class="g-stat calm" data-filter="all"><b>0</b><span>thoughts</span></button>
      </div>
      <div class="g-progress" title="Share of thoughts that aren't tangled or asking"><i></i></div>
      <div class="g-history" title="Tangled thoughts per day"><svg viewBox="0 0 120 28" preserveAspectRatio="none"><path class="line"/><circle class="dot" r="2"/></svg><span></span></div>
      <div class="g-actions">
        <button class="g-action capture" data-act="openCapture" hidden title="Add a thought (C)">＋ thought</button>
        <button class="g-action focus" data-act="enterFocus" title="One thought at a time (F)">Focus</button>
        <button class="g-action roll" data-act="pickRandom" title="Pick a random task (D)">Random</button>
        <button class="g-action fly" data-act="toggleFlight" title="Take flight (V)">Fly</button>
        <button class="g-action gear" data-act="toggleSettings" aria-label="Display settings" title="Display settings">⚙</button>
      </div>
    </header>

    <div class="g-settings" hidden>
      <div class="g-set-row"><span>Glow</span>
        <div class="g-seg" data-setting="bloom"><button data-value="on">On</button><button data-value="off">Off</button></div>
      </div>
      <div class="g-set-row"><span>Touch</span>
        <div class="g-seg" data-setting="touch"><button data-value="auto">Auto</button><button data-value="on">On</button><button data-value="off">Off</button></div>
      </div>
      <div class="g-set-row"><span>Detail</span>
        <div class="g-seg" data-setting="detail"><button data-value="low">Low</button><button data-value="balanced">Balanced</button><button data-value="high">High</button></div>
      </div>
    </div>

    <form class="g-capture" hidden autocomplete="off">
      <input class="g-capture-input" maxlength="200" placeholder="a thought, in a few words…" aria-label="New thought" />
      <select class="g-capture-list" aria-label="Which list"></select>
      <button class="g-btn resolve" type="submit">Release</button>
    </form>

    <div class="g-labels" aria-hidden="true"></div>
    <div class="g-tooltip" hidden></div>

    <article class="g-card" hidden>
      <div class="g-card-node"><i></i><span></span></div>
      <h2 class="g-card-title"></h2>
      <div class="g-card-state"></div>
      <p class="g-card-notes"></p>
      <div class="g-card-tags"></div>
      <div class="g-card-actions">
        <button class="g-btn ghost" data-act="open">Open in TickTick</button>
        <button class="g-btn resolve" data-act="resolve">Resolve</button>
      </div>
      <div class="g-card-hint"></div>
      <div class="g-card-focus" hidden>
        <span class="g-focus-count"></span>
        <button class="g-btn ghost" data-act="skipFocus">Not now</button>
        <button class="g-btn ghost" data-act="exitFocus">Leave focus</button>
      </div>
      <button class="g-close" data-act="dismiss" aria-label="Close">×</button>
    </article>

    <aside class="g-panel" hidden>
      <button class="g-back" data-act="unfocus">← all systems</button>
      <h2 class="g-panel-title"></h2>
      <div class="g-panel-sub"></div>
      <ol class="g-panel-list"></ol>
    </aside>

    <nav class="g-filters" aria-label="Filter thoughts"></nav>
    <canvas class="g-radar" width="300" height="300" hidden aria-label="Radar: systems around you. Tap one to fly there."></canvas>
    <div class="g-beacons" aria-hidden="true"></div>
    <div class="g-touch" hidden>
      <div class="g-stick" aria-label="Fly: push up to go forward, sideways to turn"><i></i></div>
      <div class="g-tbuttons">
        <button class="g-tbtn" data-hold="climb" aria-label="Rise">▲</button>
        <button class="g-tbtn" data-hold="sink" aria-label="Sink">▼</button>
        <button class="g-tbtn power" data-hold="boost" aria-label="Power up">⚡</button>
        <button class="g-tbtn wide" data-tap="land">Land</button>
        <button class="g-tbtn wide" data-tap="next">Next ›</button>
      </div>
    </div>
    <div class="g-flight" hidden>
      <div class="g-flight-near" aria-live="polite"></div>
      <div class="g-flight-keys">drag to look · <kbd>W</kbd><kbd>S</kbd> fly · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>R</kbd><kbd>F</kbd> rise / sink · <kbd>Shift</kbd> power up · <kbd>E</kbd> land · <kbd>Q</kbd> next system · <kbd>,</kbd><kbd>.</kbd> radio · <kbd>Esc</kbd> stop</div>
      <div class="g-flight-row">
        <div class="g-radio">
          <button class="g-radio-step" data-station="-1" aria-label="Previous station">‹</button>
          <button class="g-radio-dial" data-act="toggleSound" title="Radio on or off (M)">
            <span class="g-radio-name"></span>
            <span class="g-radio-tag"></span>
          </button>
          <button class="g-radio-step" data-station="1" aria-label="Next station">›</button>
        </div>
        <button class="g-chip" data-act="toggleFlight">Stop flying</button>
      </div>
    </div>
    <div class="g-hint">drag a world onto another sun to move it · <kbd>N</kbd> next tangle · <kbd>F</kbd> focus · <kbd>D</kbd> random · <kbd>V</kbd> fly · <kbd>C</kbd> capture · <kbd>U</kbd> undo · <kbd>Esc</kbd> release</div>
    <a class="g-colony" href="/colony">colony view ↗</a>
    <div class="g-toast" role="status"></div>
    <div class="g-flash" aria-hidden="true"></div>
    <div class="g-empty" hidden>
      <div class="g-title">the systems are quiet</div>
      <div class="g-sub">No open thoughts found. Add something in TickTick and it will appear here.</div>
    </div>
  `
  )

  const $ = (s) => root.querySelector(s)
  const labelsEl = $('.g-labels')
  const tooltip = $('.g-tooltip')
  const card = $('.g-card')
  const panel = $('.g-panel')
  const toastEl = $('.g-toast')
  const cursor = $('.g-cursor')

  // Filters
  const filterNav = $('.g-filters')
  for (const f of FILTERS) {
    const b = document.createElement('button')
    b.className = 'g-chip'
    b.dataset.filter = f.id
    b.textContent = f.label
    filterNav.appendChild(b)
  }
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')
    if (f) actions.filter(f.dataset.filter)
    const act = e.target.closest('[data-act]')
    if (act) actions[act.dataset.act]?.()
    const item = e.target.closest('[data-thought]')
    if (item) actions.selectThought(item.dataset.thought)
    const dial = e.target.closest('[data-station]')
    if (dial) actions.station(Number(dial.dataset.station))
    const seg = e.target.closest('.g-seg button')
    if (seg) actions.setSetting(seg.parentElement.dataset.setting, seg.dataset.value)
  })

  const captureForm = $('.g-capture')
  const captureInput = $('.g-capture-input')
  const captureList = $('.g-capture-list')
  captureForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = captureInput.value.trim()
    if (!title) return
    actions.submitCapture(title, captureList.value, captureList.selectedOptions[0]?.dataset.node || '')
    captureInput.value = ''
  })
  captureInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeCapture()
    }
  })

  function openCapture(lists, preferred) {
    captureList.innerHTML =
      `<option value="" data-node="">Inbox</option>` +
      lists.map((l) => `<option value="${esc(l.id)}" data-node="${esc(l.name)}">${esc(l.name)}</option>`).join('')
    const pick = lists.find((l) => l.name === preferred)
    if (pick) captureList.value = pick.id
    captureForm.hidden = false
    requestAnimationFrame(() => captureInput.focus())
  }
  function closeCapture() {
    captureForm.hidden = true
    captureInput.blur()
  }

  function setWritable(on) {
    $('.g-action.capture').hidden = !on
  }

  function setSettings({ bloom, detail, touch = 'auto' }) {
    for (const b of root.querySelectorAll('[data-setting="touch"] button')) b.classList.toggle('on', b.dataset.value === touch)
    for (const b of root.querySelectorAll('[data-setting="bloom"] button')) b.classList.toggle('on', b.dataset.value === (bloom ? 'on' : 'off'))
    for (const b of root.querySelectorAll('[data-setting="detail"] button')) b.classList.toggle('on', b.dataset.value === detail)
  }
  function toggleSettings(force) {
    const el = $('.g-settings')
    el.hidden = typeof force === 'boolean' ? !force : !el.hidden
  }

  /**
   * The daily record: a quiet line of tangled counts, and the change over the last week. With a
   * single day of data there's no line to draw — say that instead of drawing a flat one.
   */
  function setHistory(days) {
    const el = $('.g-history')
    const text = el.querySelector('span')
    if (days.length < 2) {
      el.classList.add('empty')
      text.textContent = 'history starts today'
      return
    }
    el.classList.remove('empty')
    const recent = days.slice(-14)
    const max = Math.max(1, ...recent.map((d) => d.tangled))
    const pts = recent.map((d, i) => [(i / (recent.length - 1)) * 116 + 2, 24 - (d.tangled / max) * 20])
    el.querySelector('.line').setAttribute('d', 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L'))
    const [lx, ly] = pts[pts.length - 1]
    el.querySelector('.dot').setAttribute('cx', lx)
    el.querySelector('.dot').setAttribute('cy', ly)
    const weekAgo = days[Math.max(0, days.length - 8)]
    const delta = days[days.length - 1].tangled - weekAgo.tangled
    text.textContent = delta < 0 ? `${-delta} fewer tangled` : delta > 0 ? `${delta} more tangled` : 'holding steady'
    el.classList.toggle('better', delta < 0)
    el.classList.toggle('worse', delta > 0)
  }

  function setFlight(on) {
    $('.g-flight').hidden = !on
    root.classList.toggle('flight-mode', on)
    $('.g-action.fly').textContent = on ? 'Stop flying' : 'Fly'
    if (!on) setFlightNear(null)
  }

  /** What you're flying beside: a world you could land on, or the one you're sitting with. */
  function setFlightNear(info) {
    const el = $('.g-flight-near')
    if (!info) {
      el.className = 'g-flight-near'
      el.textContent = ''
      return
    }
    const { thought, landed } = info
    el.className = `g-flight-near show ${thought.state}`
    el.innerHTML = landed
      ? `Sitting with <b>${esc(thought.thread.title)}</b> · <kbd>E</kbd> or <kbd>W</kbd> to fly on`
      : `<kbd>E</kbd> land beside <b>${esc(thought.thread.title)}</b>`
  }

  /** The dial: which station is playing, or that the radio is off. */
  function setRadio({ on, name, tag }) {
    const dial = $('.g-radio-dial')
    dial.classList.toggle('on', on)
    $('.g-radio-name').textContent = on ? name : 'Radio off'
    $('.g-radio-tag').textContent = on ? tag : 'M or click to play'
  }

  // ── flying: touch controls ─────────────────────────────────────────────────────────
  // A thumb stick (push up to fly, sideways to turn), hold buttons for rise/sink/power, and taps
  // for land and next system. Dragging anywhere else on the sky still aims the view.
  const stick = $('.g-stick')
  const knob = stick.querySelector('i')
  let stickId = null
  const stickMove = (e) => {
    const r = stick.getBoundingClientRect()
    const max = r.width / 2
    let x = e.clientX - (r.left + max)
    let y = e.clientY - (r.top + max)
    const len = Math.hypot(x, y)
    if (len > max) {
      x = (x / len) * max
      y = (y / len) * max
    }
    knob.style.transform = `translate(${x}px, ${y}px)`
    // A small dead zone, then a gentle curve so small nudges stay small.
    const shape = (v) => Math.sign(v) * Math.max(0, (Math.abs(v) - 0.12) / 0.88) ** 1.4
    actions.touchInput({ thrust: shape(-y / max), turn: shape(-x / max) })
  }
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId
    stick.setPointerCapture(e.pointerId)
    stickMove(e)
  })
  stick.addEventListener('pointermove', (e) => e.pointerId === stickId && stickMove(e))
  const stickEnd = (e) => {
    if (e.pointerId !== stickId) return
    stickId = null
    knob.style.transform = ''
    actions.touchInput({ thrust: 0, turn: 0 })
  }
  stick.addEventListener('pointerup', stickEnd)
  stick.addEventListener('pointercancel', stickEnd)
  for (const b of root.querySelectorAll('.g-tbtn[data-hold]')) {
    const on = (v) => (e) => {
      e.preventDefault()
      b.classList.toggle('held', v)
      actions.touchHold(b.dataset.hold, v)
    }
    b.addEventListener('pointerdown', on(true))
    b.addEventListener('pointerup', on(false))
    b.addEventListener('pointercancel', on(false))
    b.addEventListener('pointerleave', on(false))
  }
  for (const b of root.querySelectorAll('.g-tbtn[data-tap]')) b.addEventListener('click', () => actions.touchTap(b.dataset.tap))

  function setTouch(on) {
    $('.g-touch').hidden = !on
    root.classList.toggle('touch-flight', on)
  }

  // ── flying: radar and edge markers ─────────────────────────────────────────────────
  // A top-down radar that turns with you (straight ahead is up), and arrows at the screen edge
  // pointing to systems you can't see. Between them it's hard to lose your way.
  const radar = $('.g-radar')
  const rctx = radar.getContext('2d')
  const RADAR_RANGE = 320
  let radarDots = []
  radar.addEventListener('click', (e) => {
    const r = radar.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * radar.width
    const y = ((e.clientY - r.top) / r.height) * radar.height
    const hit = radarDots.reduce((best, d) => (Math.hypot(d.x - x, d.y - y) < (best ? Math.hypot(best.x - x, best.y - y) : 40) ? d : best), null)
    if (hit) actions.flyToSystem(hit.name)
  })

  function drawRadar(web, nav) {
    const W = radar.width
    const c = W / 2
    const R = W / 2 - 14
    const scale = R / RADAR_RANGE
    rctx.clearRect(0, 0, W, W)
    rctx.save()
    const bg = rctx.createRadialGradient(c, c, 0, c, c, R + 10)
    bg.addColorStop(0, 'rgba(18,14,12,0.72)')
    bg.addColorStop(1, 'rgba(8,6,6,0.5)')
    rctx.fillStyle = bg
    rctx.beginPath()
    rctx.arc(c, c, R + 10, 0, Math.PI * 2)
    rctx.fill()
    rctx.strokeStyle = 'rgba(244,236,223,0.12)'
    rctx.lineWidth = 2
    for (const f of [1, 0.5]) {
      rctx.beginPath()
      rctx.arc(c, c, R * f, 0, Math.PI * 2)
      rctx.stroke()
    }
    // Field of view wedge, straight ahead.
    rctx.fillStyle = 'rgba(244,236,223,0.05)'
    rctx.beginPath()
    rctx.moveTo(c, c)
    rctx.arc(c, c, R, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45)
    rctx.fill()

    const cosA = Math.cos(nav.aimYaw)
    const sinA = Math.sin(nav.aimYaw)
    const place = (p) => {
      const dx = p.x - nav.pos.x
      const dz = p.z - nav.pos.z
      // Right = (cos, −sin); ahead = (−sin, −cos).
      let sx = dx * cosA - dz * sinA
      let sy = -(dx * sinA + dz * cosA)
      const dist = Math.hypot(sx, sy)
      const edge = dist * scale > R
      if (edge) {
        sx = (sx / dist) * (RADAR_RANGE - 4)
        sy = (sy / dist) * (RADAR_RANGE - 4)
      }
      return { x: c + sx * scale, y: c - sy * scale, edge, dist: Math.hypot(dx, dz), dy: p.y - nav.pos.y }
    }

    // Worlds near you: tiny dots, coloured by state.
    for (const t of web.thoughts.values()) {
      if (t.leaving || t.dissolving !== null) continue
      const q = place(t.world)
      if (q.edge) continue
      rctx.fillStyle = t.state === 'tangled' ? 'rgba(255,90,74,0.9)' : t.state === 'asking' ? 'rgba(255,196,107,0.9)' : 'rgba(244,236,223,0.45)'
      rctx.beginPath()
      rctx.arc(q.x, q.y, t.state === 'drifting' ? 2 : 3, 0, Math.PI * 2)
      rctx.fill()
    }
    // Suns, with their names, clamped to the rim when out of range.
    radarDots = []
    rctx.font = '600 17px Manrope, system-ui, sans-serif'
    rctx.textAlign = 'center'
    for (const n of web.nodes.values()) {
      if (n.leaving) continue
      const q = place(n.pos)
      const hex = `#${n.color.getHexString()}`
      const heading = nav.heading === n.name
      rctx.fillStyle = hex
      rctx.shadowColor = hex
      rctx.shadowBlur = heading ? 18 : 10
      rctx.beginPath()
      rctx.arc(q.x, q.y, q.edge ? 5 : 7, 0, Math.PI * 2)
      rctx.fill()
      rctx.shadowBlur = 0
      if (heading) {
        rctx.strokeStyle = hex
        rctx.lineWidth = 2
        rctx.beginPath()
        rctx.arc(q.x, q.y, 13 + Math.sin(performance.now() / 180) * 2, 0, Math.PI * 2)
        rctx.stroke()
      }
      if (!q.edge) {
        rctx.fillStyle = 'rgba(244,236,223,0.75)'
        rctx.fillText(n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name, q.x, q.y - 13)
      }
      radarDots.push({ name: n.name, x: q.x, y: q.y })
    }
    // You: a chevron pointing ahead.
    rctx.fillStyle = '#f4ecdf'
    rctx.beginPath()
    rctx.moveTo(c, c - 10)
    rctx.lineTo(c + 7, c + 7)
    rctx.lineTo(c, c + 3)
    rctx.lineTo(c - 7, c + 7)
    rctx.closePath()
    rctx.fill()
    rctx.restore()
  }

  const beaconsEl = $('.g-beacons')
  const beacons = new Map()
  const ndc = { x: 0, y: 0 }
  function placeBeacons(web, camera, nav) {
    const seen = new Set()
    const placed = []
    for (const n of web.nodes.values()) {
      if (n.leaving) continue
      seen.add(n.name)
      let el = beacons.get(n.name)
      if (!el) {
        el = document.createElement('button')
        el.className = 'g-beacon'
        el.innerHTML = '<i></i><span class="n"></span><span class="d"></span>'
        el.addEventListener('click', () => actions.flyToSystem(n.name))
        beaconsEl.appendChild(el)
        beacons.set(n.name, el)
      }
      const v = n.pos.clone().applyMatrix4(camera.matrixWorldInverse)
      const behind = v.z > 0
      const p = n.pos.clone().project(camera)
      ndc.x = behind ? -p.x : p.x
      ndc.y = behind ? -p.y : p.y
      const onScreen = !behind && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.88
      // No marker for the system you're already in — only the ones worth finding.
      const here = n.pos.distanceTo(nav.pos) < n.radius * 1.5 + 50
      el.hidden = onScreen || here
      if (el.hidden) continue
      // Push the point out to the screen's edge along its direction from the centre.
      const a = Math.atan2(ndc.y, ndc.x)
      const m = Math.max(Math.abs(Math.cos(a)) / 0.9, Math.abs(Math.sin(a)) / 0.8)
      const ex = Math.cos(a) / m
      const ey = Math.sin(a) / m
      // Keep the whole chip on screen, clear of the top bar, and don't let chips pile onto each other.
      const w = el.offsetWidth || 120
      const h = el.offsetHeight || 26
      let x = Math.max(12 + w / 2, Math.min(innerWidth - 12 - w / 2, (ex * 0.5 + 0.5) * innerWidth))
      let y = Math.max(90 + h / 2, Math.min(innerHeight - 70 - h / 2, (-ey * 0.5 + 0.5) * innerHeight))
      for (let pass = 0; pass < 4; pass++) {
        const clash = placed.find((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < (q.h + h) / 2 + 4)
        if (!clash) break
        y = y + h + 6 > innerHeight - 70 - h / 2 ? clash.y - h - 6 : clash.y + h + 6
      }
      placed.push({ x, y, w, h })
      el.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0)`
      el.querySelector('i').style.transform = `rotate(${(-a).toFixed(3)}rad)`
      el.querySelector('i').style.background = `#${n.color.getHexString()}`
      el.querySelector('.n').textContent = n.name
      el.querySelector('.d').textContent = `${Math.round(n.pos.distanceTo(nav.pos))} away`
      el.classList.toggle('heading', nav.heading === n.name)
    }
    for (const [name, el] of beacons) {
      if (!seen.has(name)) {
        el.remove()
        beacons.delete(name)
      }
    }
  }

  function setNav(on) {
    radar.hidden = !on
    beaconsEl.hidden = !on
  }

  function setFocus(info) {
    const row = card.querySelector('.g-card-focus')
    row.hidden = !info
    root.classList.toggle('focus-mode', Boolean(info))
    if (info) row.querySelector('.g-focus-count').textContent = `${info.index + 1} of ${info.total}`
  }

  // A soft light that trails the pointer — the only "effect" that isn't data, and it only
  // ever follows your hand.
  let cx = innerWidth / 2
  let cy = innerHeight / 2
  let tx = cx
  let ty = cy
  addEventListener('pointermove', (e) => {
    tx = e.clientX
    ty = e.clientY
  })

  const labels = new Map()

  function setFilter(id) {
    for (const b of root.querySelectorAll('[data-filter]')) b.classList.toggle('on', b.dataset.filter === id)
  }

  function setMeter({ tangled, asking, total }) {
    $('.g-stat.tangled b').textContent = tangled
    $('.g-stat.asking b').textContent = asking
    $('.g-stat.calm b').textContent = total
    const calm = total ? (total - tangled - asking) / total : 1
    $('.g-progress i').style.transform = `scaleX(${calm})`
    $('.g-empty').hidden = total > 0
  }

  function syncLabels(web) {
    for (const [name, n] of web.nodes) {
      let el = labels.get(name)
      if (!el) {
        el = document.createElement('button')
        el.className = 'g-label'
        el.innerHTML = `<i></i><span class="n"></span><span class="c"></span>`
        el.addEventListener('click', () => actions.focusNode(name))
        labelsEl.appendChild(el)
        labels.set(name, el)
      }
      const list = [...web.thoughts.values()].filter((t) => t.node === name && !t.leaving)
      const tangled = list.filter((t) => t.state === 'tangled').length
      const asking = list.filter((t) => t.state === 'asking').length
      el.querySelector('i').style.background = `#${n.color.getHexString()}`
      el.querySelector('.n').textContent = name
      el.querySelector('.c').textContent =
        `${list.length} thought${list.length === 1 ? '' : 's'}` +
        (tangled ? ` · ${tangled} tangled` : '') +
        (asking ? ` · ${asking} asking` : '')
    }
    for (const [name, el] of labels) {
      if (!web.nodes.has(name)) {
        el.remove()
        labels.delete(name)
      }
    }
  }

  function placeLabels(web, focusNode) {
    for (const [name, el] of labels) {
      const n = web.nodes.get(name)
      if (!n) continue
      const s = web.screenOf(n.pos)
      const fade = Math.max(0, Math.min(1, (1100 - s.depth) / 350)) * Math.min(1, n.glow)
      const dim = focusNode && focusNode !== name ? 0.2 : 1
      el.style.opacity = s.visible ? (fade * dim).toFixed(3) : '0'
      el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${(s.y + 18 + Math.min(320, (n.radius || 0) * s.ppu * 1.9)).toFixed(1)}px, 0) translate(-50%, 0)`
      el.style.pointerEvents = s.visible && fade * dim > 0.3 ? 'auto' : 'none'
    }
  }

  function showTooltip(web, h, x, y) {
    if (!h || h.kind !== 'thought') {
      tooltip.hidden = true
      return
    }
    const t = web.thoughts.get(h.id)
    if (!t) return
    tooltip.hidden = false
    tooltip.className = `g-tooltip ${t.state}`
    tooltip.textContent = t.thread.title
    tooltip.style.transform = `translate3d(${x + 16}px, ${y - 14}px, 0)`
  }

  function fillCard(web, id) {
    const t = web.thoughts.get(id)
    if (!t) {
      card.hidden = true
      return
    }
    const node = web.nodes.get(t.node)
    card.hidden = false
    card.dataset.state = t.state
    card.querySelector('.g-card-node i').style.background = node ? `#${node.color.getHexString()}` : '#fff'
    card.querySelector('.g-card-node span').textContent = t.node
    card.querySelector('.g-card-title').textContent = t.thread.title
    const parts = [STATE_WORD[stateOf(t.thread)]]
    if (t.thread.model) parts.push(t.thread.model)
    if (t.thread.effort) parts.push(t.thread.effort)
    card.querySelector('.g-card-state').textContent = parts.join(' · ')
    const notes = card.querySelector('.g-card-notes')
    notes.textContent = t.thread.preview || ''
    notes.hidden = !t.thread.preview
    card.querySelector('.g-card-tags').innerHTML = (t.thread.tags || []).map((g) => `<span>#${esc(g)}</span>`).join('')
    const resolve = card.querySelector('[data-act="resolve"]')
    resolve.disabled = !t.thread.canResolve
    card.querySelector('.g-card-hint').textContent = t.thread.canResolve
      ? ''
      : 'Resolving from here is off — run the TickTick login with --write to turn it on.'
    card.querySelector('[data-act="open"]').disabled = !t.thread.canOpen
  }

  function placeCard(web, id) {
    const t = web.thoughts.get(id)
    if (!t || card.hidden) return
    const s = web.screenOf(t.world)
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 200
    const panelRoom = panel.hidden ? 0 : 340
    // Clear the planet itself (and its rings, if it has them), not just its centre.
    const clear = 28 + Math.min(260, (t.size || 1) * s.ppu * 2.5)
    let x = s.x + clear
    let y = s.y - h / 2
    if (x + w > innerWidth - panelRoom - 16) x = s.x - w - clear
    x = Math.max(16, Math.min(innerWidth - w - 16, x))
    y = Math.max(84, Math.min(innerHeight - h - 90, y))
    card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    card.style.opacity = s.visible ? '1' : '0'
  }

  /** While sitting with a task in flight, the card waits at the right edge, clear of you and the world. */
  function dockCard() {
    if (card.hidden) return
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 200
    const x = innerWidth > 760 ? innerWidth - w - 32 : 16
    const y = innerWidth > 760 ? Math.max(84, innerHeight / 2 - h / 2) : 84
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`
    card.style.opacity = '1'
  }

  let panelSig = ''
  function fillPanel(web, name) {
    if (!name) {
      panel.hidden = true
      panelSig = ''
      return
    }
    const node = web.nodes.get(name)
    const order = { tangled: 0, asking: 1, drifting: 2 }
    const list = [...web.thoughts.values()]
      .filter((t) => t.node === name && !t.leaving)
      .sort((a, b) => order[a.state] - order[b.state] || (Number(b.thread.urgency) || 0) - (Number(a.thread.urgency) || 0))
    // Rebuilding the list on every poll would swallow a click or keyboard focus mid-gesture —
    // only redraw when something in it actually changed.
    const sig = name + '|' + list.map((t) => `${t.id}:${t.state}:${t.thread.title}:${t.thread.model}`).join('|')
    panel.hidden = false
    if (sig === panelSig) return
    panelSig = sig
    panel.querySelector('.g-panel-title').textContent = name
    panel.querySelector('.g-panel-title').style.setProperty('--hue', node ? `#${node.color.getHexString()}` : '#fff')
    const tangled = list.filter((t) => t.state === 'tangled').length
    panel.querySelector('.g-panel-sub').textContent =
      `${list.length} thought${list.length === 1 ? '' : 's'}` + (tangled ? ` · ${tangled} tangled` : ' · nothing tangled')
    panel.querySelector('.g-panel-list').innerHTML = list
      .map(
        (t) => `<li><button class="${t.state}" data-thought="${esc(t.id)}"><i></i><span class="t">${esc(t.thread.title)}</span><span class="m">${esc(t.thread.model || '')}</span></button></li>`
      )
      .join('')
  }

  /** A brief wash of light over the whole screen, for the moment an attack lands. */
  function flash(strength = 0.5, color = '#ffffff') {
    const el = $('.g-flash')
    el.style.transition = 'none'
    el.style.background = `radial-gradient(circle at 50% 45%, ${color} 0%, ${color}00 70%)`
    el.style.opacity = String(Math.min(1, strength))
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${Math.round(500 + strength * 900)}ms cubic-bezier(0.22, 1, 0.36, 1)`
      el.style.opacity = '0'
    })
  }

  let toastTimer = 0
  /** A short note at the bottom. Pass `action` ({ label, run, ms }) to offer a button, like Undo. */
  function toast(msg, kind = '', action = null) {
    toastEl.textContent = msg
    if (action) {
      const button = document.createElement('button')
      button.className = 'g-toast-action'
      button.textContent = action.label
      button.addEventListener('click', () => {
        toastEl.className = 'g-toast'
        action.run()
      })
      toastEl.append(button)
    }
    toastEl.className = `g-toast show ${kind}${action ? ' has-action' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastEl.className = 'g-toast'), action?.ms || 3600)
  }

  function frame(dt) {
    const k = 1 - Math.exp(-dt * 14)
    cx += (tx - cx) * k
    cy += (ty - cy) * k
    cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
  }

  return {
    setFilter, setMeter, syncLabels, placeLabels, showTooltip, fillCard, placeCard, dockCard, fillPanel, flash, toast, frame, card, panel,
    openCapture, closeCapture, setWritable, setSettings, toggleSettings, setHistory, setFocus, setFlight, setFlightNear, setRadio,
    setTouch, drawRadar, placeBeacons, setNav,
    get capturing() {
      return !captureForm.hidden
    },
  }
}
