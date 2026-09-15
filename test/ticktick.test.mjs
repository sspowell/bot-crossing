/**
 * The TickTick mapping: one task in, one astronaut out. No network — every task here is a
 * fixture, and "now" is pinned so due-date behaviour doesn't depend on when the suite runs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import ticktick, { toThread, dueState, parseDate } from '../server/harnesses/ticktick.mjs'

// `statusFor` lives in src/game/colony.js, which only loads inside the Vite build. These assert
// on the three fields it reads, in its own precedence: hasError → blocked, unread → waiting,
// lastActivityAt older than three days → sleeping, otherwise idle.
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
const statusFor = (t, now) =>
  t.hasError ? 'blocked' : t.running ? 'working' : t.unread ? 'waiting' : now - t.lastActivityAt > THREE_DAYS ? 'sleeping' : 'idle'

// Noon local time on Sept 14, 2026.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime()
const iso = (d) => d.toISOString().replace('Z', '+0000')

test('parses TickTick dates, including the offset with no colon', () => {
  assert.equal(parseDate('2026-09-14T04:00:00.000+0000'), Date.UTC(2026, 8, 14, 4, 0, 0))
  assert.equal(parseDate(''), 0)
  assert.equal(parseDate('not a date'), 0)
})

test('due state: overdue, today, later, none', () => {
  const yesterday = new Date(2026, 8, 13, 0, 0, 0)
  const today = new Date(2026, 8, 14, 0, 0, 0)
  const tomorrow = new Date(2026, 8, 15, 0, 0, 0)

  // All-day tasks own their whole day: today's isn't overdue at noon, yesterday's is.
  assert.equal(dueState({ dueDate: iso(yesterday), isAllDay: true }, NOW), 'overdue')
  assert.equal(dueState({ dueDate: iso(today), isAllDay: true }, NOW), 'today')
  assert.equal(dueState({ dueDate: iso(tomorrow), isAllDay: true }, NOW), 'later')

  // Timed tasks are overdue the moment their time passes, even on the same day.
  assert.equal(dueState({ dueDate: iso(new Date(2026, 8, 14, 9, 0)), isAllDay: false }, NOW), 'overdue')
  assert.equal(dueState({ dueDate: iso(new Date(2026, 8, 14, 17, 0)), isAllDay: false }, NOW), 'today')

  assert.equal(dueState({}, NOW), 'none')
})

test('an overdue task slumps, a due-today task waves, everything else potters', () => {
  const overdue = toThread({ id: 'a', projectId: 'p', title: 'Pay car loan', dueDate: iso(new Date(2026, 8, 12)), isAllDay: true }, 'Money', NOW)
  const today = toThread({ id: 'b', projectId: 'p', title: 'Capture headshot', dueDate: iso(new Date(2026, 8, 14)), isAllDay: true }, 'Content', NOW)
  const someday = toThread({ id: 'c', projectId: 'p', title: 'Research tents' }, 'Ideas', NOW)

  assert.equal(statusFor(overdue, NOW), 'blocked')
  assert.equal(statusFor(today, NOW), 'waiting')
  assert.equal(statusFor(someday, NOW), 'idle')
})

test('an untouched task with no due date never goes dormant', () => {
  const old = toThread({ id: 'd', projectId: 'p', title: 'Old idea', modifiedTime: '2026-01-01T00:00:00.000+0000' }, 'Ideas', NOW)
  assert.equal(statusFor(old, NOW), 'idle')
})

test('the list becomes the zone, and the link opens the task in TickTick', () => {
  const t = toThread({ id: 'task1', projectId: 'list9', title: 'x' }, 'Basecamp Bodywork', NOW)
  assert.equal(t.id, 'ticktick:task1')
  assert.equal(t.project, 'Basecamp Bodywork')
  assert.equal(t.ref.url, 'https://ticktick.com/webapp/#p/list9/tasks/task1')
  assert.equal(ticktick.openThread(t.ref).ok, true)
})

test('checklist items become moons, and overdue has a real number of days', () => {
  const t = toThread(
    {
      id: 'm', projectId: 'p', title: 'Prep class',
      dueDate: iso(new Date(2026, 8, 10)), isAllDay: true,
      items: [{ title: 'Playlist', status: 1 }, { title: 'Warmup', status: 0 }],
    },
    'Fitness', NOW
  )
  assert.deepEqual(t.items, [{ title: 'Playlist', done: true }, { title: 'Warmup', done: false }])
  // Due all day Sept 10 → overdue from the end of that day → 3.5 days by noon on the 14th.
  assert.equal(t.overdueDays, 3.5)
  assert.equal(t.listId, 'p')
  assert.ok(t.dueAt > 0)
})

test('writes are validated before anything reaches TickTick', async () => {
  assert.equal((await ticktick.createThread({ title: '   ' })).ok, false)
  assert.equal((await ticktick.createThread({ title: 'x', listId: '../../etc' })).ok, false)
  assert.equal((await ticktick.moveThread({ projectId: 'a', taskId: 'b/../c' }, 'z')).ok, false)
  assert.equal((await ticktick.completeThread({ projectId: 'a?x=1', taskId: 'b' })).ok, false)
})

test('priority reaches building size, and nothing carries the token', () => {
  const high = toThread({ id: 'h', projectId: 'p', title: 'x', priority: 5 }, 'L', NOW)
  const none = toThread({ id: 'n', projectId: 'p', title: 'x', priority: 0 }, 'L', NOW)
  assert.ok(high.urgency > none.urgency)
  assert.ok(high.sizeBytes > none.sizeBytes)
  assert.doesNotMatch(JSON.stringify(high), /access_token|Bearer/i)
})
