import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset } from '../src/model'
import { emptyState, exportBackup, loadAppData, mergeDataset, recoverBeforeRestore, restoreBackup, saveState, validateBackup } from '../src/store'

const original = JSON.parse(readFileSync(new URL('../public/data/original.json', import.meta.url), 'utf8')) as Dataset
function learned() {
  const state = emptyState()
  const id = original.questions[0].id
  state.sessions.push({ id: 's1', startedAt: '2026-10-27T00:00:00Z', viewed: [id] })
  state.mistakes.push({ id: 'm1', questionId: id, at: '2026-10-27T00:01:00Z', sessionId: 's1' })
  state.flags[id] = true
  state.tags[id] = ['復習']
  state.position = { id, offset: -18 }
  state.edits[id] = { question: structuredClone(original.questions[0]), answers: structuredClone(original.answers.filter(a => a.question_id === id)) }
  return state
}

describe('backup protection and persistence', () => {
  it('roundtrips original, overlay, per-event history, filters and anchor', () => {
    const state = learned()
    const restored = validateBackup(exportBackup(original, state))
    expect(restored.dataset).toEqual(original)
    expect(restored.state).toEqual(state)
  })
  it('rejects an unrelated JSON document without writing', () => {
    expect(() => validateBackup(original)).toThrow('バックアップ形式')
  })
  it('rejects orphan mistake references and duplicate event IDs', () => {
    const state = learned(); state.mistakes[0].questionId = 'missing'
    expect(() => validateBackup(exportBackup(original, state))).toThrow('間違い記録')
    const duplicate = learned(); duplicate.mistakes.push({ ...duplicate.mistakes[0] })
    expect(() => validateBackup(exportBackup(original, duplicate))).toThrow('重複')
  })
  it('rejects corrupted edited blank-to-answer references', () => {
    const state = learned(); const edit = state.edits[original.questions[0].id]
    edit.answers = []
    expect(() => validateBackup(exportBackup(original, state))).toThrow('編集データ')
  })
  it('rejects invalid edited importance and blank stars before restoring', () => {
    const state = learned(); const edit = state.edits[original.questions[0].id]
    edit.question.importance_stars = 9
    expect(() => validateBackup(exportBackup(original, state))).toThrow('編集データ')
    edit.question.importance_stars = 1
    edit.question.segments.find(segment => segment.type === 'blank')!.stars = 5
    expect(() => validateBackup(exportBackup(original, state))).toThrow('編集データ')
  })
  it('persists separate original, edits, learning records and preferences', async () => {
    await loadAppData(original)
    const state = learned()
    await saveState(state)
    const loaded = await loadAppData(original)
    expect(loaded.dataset).toEqual(original)
    expect(loaded.state).toEqual(state)
  })
  it('snapshots calls immediately and orders rapid saves', async () => {
    const state = learned()
    const first = saveState(state)
    state.mistakes.push({ ...state.mistakes[0], id: 'm2' })
    const second = saveState(state)
    state.mistakes.length = 0
    await Promise.all([first, second])
    expect((await loadAppData(original)).state.mistakes).toHaveLength(2)
  })
  it('atomically restores and retains recoverable data from before replacement', async () => {
    const before = learned(); before.settings.fontSize = 20
    await saveState(before)
    const replacement = emptyState()
    await restoreBackup(exportBackup(original, replacement))
    expect((await loadAppData(original)).state.mistakes).toHaveLength(0)
    await recoverBeforeRestore()
    expect((await loadAppData(original)).state).toEqual(before)
  })
})

describe('safe dataset imports', () => {
  it('identical reimport leaves the original and its metadata intact', () => {
    const result = mergeDataset(original, structuredClone(original))
    expect(result.added).toBe(0); expect(result.conflicts).toEqual([]); expect(result.dataset).toEqual(original)
  })
  it('reports conflicting question and answer IDs without overwriting them', () => {
    const incoming = structuredClone(original)
    incoming.questions[0].segments[0].text = '競合した新しい問題文'
    incoming.answers[0].text = '競合した解答'
    const result = mergeDataset(original, incoming)
    expect(result.conflicts).toContain(`questions:${original.questions[0].id}`)
    expect(result.conflicts).toContain(`answers:${original.answers[0].id}`)
    expect(result.dataset.questions[0]).toEqual(original.questions[0])
    expect(result.dataset.answers[0]).toEqual(original.answers[0])
  })
  it('adds independent new problem IDs with exact answer correspondence', () => {
    const incoming = structuredClone(original)
    const q = structuredClone(original.questions[0])
    const oldId = q.id; q.id = `${oldId}-new`; q.answer_ids = []
    q.segments = [{ id: `${q.id}-t`, type: 'text', text: '追加された問題' }]; q.notes = []
    incoming.questions.push(q)
    incoming.pages.find(p => p.id === q.page_id)!.question_ids.push(q.id)
    const result = mergeDataset(original, incoming)
    expect(result.added).toBe(1)
    expect(result.dataset.questions.at(-1)!.id).toBe(q.id)
    expect(result.dataset.pages.find(p => p.id === q.page_id)!.question_ids).toContain(q.id)
    expect(result.dataset.questions.find(p => p.id === oldId)).toEqual(original.questions[0])
  })
})
