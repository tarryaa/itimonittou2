import { useRef, useState } from 'react';
import type { Answer, Note, Question, Segment } from './model';

type Props = {
  question: Question;
  answers: Answer[];
  original: Question;
  originalAnswers: Answer[];
  onSave: (question: Question, answers: Answer[]) => void;
  onClose: () => void;
};
type Place = { note?: string };
const copy = <T,>(value: T): T => structuredClone(value);

export default function Editor({ question, answers, original, originalAnswers, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Question>(() => copy(question));
  const [draftAnswers, setDraftAnswers] = useState<Answer[]>(() => copy(answers));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const selection = useRef<Record<string, [number, number]>>({});
  const uid = (kind: string) => `${question.id}-${kind}-${crypto.randomUUID()}`;
  const segmentsAt = (place: Place) => place.note ? draft.notes.find(n => n.id === place.note)?.segments ?? [] : draft.segments;
  function editSegments(place: Place, segments: Segment[]) {
    setDirty(true);
    setDraft(current => place.note ? {
      ...current, notes: current.notes.map(note => note.id === place.note ? { ...note, segments } : note),
    } : { ...current, segments });
  }
  function changeSegment(place: Place, id: string, patch: Partial<Segment>) {
    editSegments(place, segmentsAt(place).map(segment => segment.id === id ? { ...segment, ...patch } : segment));
  }
  function replaceSegment(place: Place, id: string, replacements: Segment[]) {
    editSegments(place, segmentsAt(place).flatMap(segment => segment.id === id ? replacements : [segment]));
  }
  function updateAnswer(id: string, patch: Partial<Answer>) {
    setDirty(true);
    setDraftAnswers(current => current.map(answer => answer.id === id ? { ...answer, ...patch } : answer));
  }
  function removeAnswer(id: string) {
    setDraftAnswers(current => current.filter(answer => answer.id !== id));
  }
  function makeBlank(segment: Segment): Segment {
    const answer: Answer = {
      id: uid('a'), question_id: question.id, blank_id: segment.id,
      text: segment.text ?? '', fill_text: segment.text ?? '', display_order: draftAnswers.length + 1,
      style: { color: 'red' },
    };
    setDraftAnswers(current => [...current, answer]);
    return { ...segment, type: 'blank', text: undefined, stars: 0, answer_id: answer.id, style: { ...segment.style, box: true } };
  }
  function convert(place: Place, segment: Segment, type: string) {
    if (type === segment.type) return;
    let changed: Segment;
    if (type === 'blank') changed = makeBlank(segment);
    else {
      const answer = draftAnswers.find(a => a.id === segment.answer_id);
      changed = {
        ...segment, type, text: segment.type === 'blank' ? answer?.fill_text ?? answer?.text ?? '' : segment.text ?? '',
        answer_id: undefined, stars: undefined,
        style: { ...segment.style, box: false, color: type === 'red_text' ? 'red' : 'black' },
      };
      if (segment.type === 'blank' && segment.answer_id) removeAnswer(segment.answer_id);
    }
    replaceSegment(place, segment.id, [changed]);
  }
  function splitSelection(place: Place, segment: Segment, type: string) {
    const [start, end] = selection.current[segment.id] ?? [0, 0];
    const text = segment.text ?? '';
    if (start === end) { setError('変更する文字を本文の入力欄で選択してください。'); return; }
    setError('');
    const pieces: Segment[] = [];
    if (start) pieces.push({ ...segment, id: uid('t'), text: text.slice(0, start) });
    let middle: Segment = { ...segment, id: uid('s'), type: type === 'blank' ? 'text' : type, text: text.slice(start, end), style: { ...segment.style, color: type === 'red_text' ? 'red' : 'black' } };
    if (type === 'blank') middle = makeBlank(middle);
    pieces.push(middle);
    if (end < text.length) pieces.push({ ...segment, id: uid('t'), text: text.slice(end) });
    replaceSegment(place, segment.id, pieces);
  }
  function deleteSegment(place: Place, segment: Segment) {
    if (segment.type === 'blank' && segment.answer_id) removeAnswer(segment.answer_id);
    replaceSegment(place, segment.id, []);
  }
  function moveSegment(place: Place, id: string, delta: number) {
    const segments = [...segmentsAt(place)];
    const from = segments.findIndex(segment => segment.id === id);
    const to = from + delta;
    if (to < 0 || to >= segments.length) return;
    [segments[from], segments[to]] = [segments[to], segments[from]];
    editSegments(place, segments);
  }
  // Answers belong to this question. Changing the link swaps occupied links so no other blank loses its answer.
  function linkAnswer(place: Place, segment: Segment, nextId: string) {
    if (nextId === segment.answer_id) return;
    const swap = (segments: Segment[]) => segments.map(s => s.id === segment.id ? { ...s, answer_id: nextId } : s.answer_id === nextId ? { ...s, answer_id: segment.answer_id } : s);
    setDirty(true);
    setDraft(current => ({ ...current, segments: swap(current.segments), notes: current.notes.map(note => ({ ...note, segments: swap(note.segments) })) }));
    void place;
  }
  function addNote() {
    setDirty(true);
    setDraft(current => ({ ...current, notes: [...current.notes, {
      id: uid('n'), marker: '※', order: current.notes.length + 1, style: { size: 'small' },
      segments: [{ id: uid('t'), type: 'text', text: '', style: { color: 'black', size: 'small' } }],
    }] }));
  }
  function updateNote(id: string, patch: Partial<Note>) {
    setDirty(true);
    setDraft(current => ({ ...current, notes: current.notes.map(note => note.id === id ? { ...note, ...patch } : note) }));
  }
  function deleteNote(note: Note) {
    const ids = new Set(note.segments.filter(s => s.type === 'blank').map(s => s.answer_id));
    setDraftAnswers(current => current.filter(answer => !ids.has(answer.id)));
    setDirty(true);
    setDraft(current => ({ ...current, notes: current.notes.filter(n => n.id !== note.id) }));
  }
  function save() {
    const allSegments = [...draft.segments, ...draft.notes.flatMap(note => note.segments)];
    const blanks = allSegments.filter(segment => segment.type === 'blank');
    if (new Set(allSegments.map(segment => segment.id)).size !== allSegments.length) { setError('セグメントIDが重複しています。'); return; }
    if (new Set(blanks.map(segment => segment.answer_id)).size !== blanks.length) { setError('複数の空欄に同じ解答が対応しています。'); return; }
    if (blanks.some(segment => !draftAnswers.some(answer => answer.id === segment.answer_id))) { setError('対応する解答がない空欄があります。'); return; }
    if (blanks.some(segment => { const answer = draftAnswers.find(a => a.id === segment.answer_id); return !answer?.text.trim() && !answer?.fill_text?.trim(); })) { setError('空欄に対応する解答を入力してください。'); return; }
    if (draft.id !== question.id || draft.page_id !== question.page_id) { setError('問題IDとページIDは変更できません。'); return; }
    const ordered = blanks.map((segment, i) => ({
      ...draftAnswers.find(answer => answer.id === segment.answer_id)!, question_id: question.id,
      blank_id: segment.id, display_order: i + 1,
    }));
    const unlinked = draftAnswers.filter(answer => !blanks.some(segment => segment.answer_id === answer.id));
    onSave({ ...draft, answer_ids: ordered.map(answer => answer.id) }, [...ordered, ...unlinked]);
  }
  function close() {
    if (!dirty || window.confirm('未保存の編集を破棄して閉じますか？')) onClose();
  }
  function renderSegments(place: Place) {
    const segments = segmentsAt(place);
    return <div className="segment-list">
      {segments.map((segment, index) => {
        const answer = draftAnswers.find(a => a.id === segment.answer_id);
        return <fieldset className="segment-editor" key={segment.id}>
          <legend>{index + 1}. {segment.type === 'blank' ? '空欄と解答' : segment.type === 'red_text' ? '赤字' : '本文'}</legend>
          <div className="editor-row">
            <label>種類<select aria-label={`部分${index + 1}の種類`} value={segment.type} onChange={event => convert(place, segment, event.target.value)}>
              <option value="text">黒字</option><option value="red_text">赤字</option><option value="blank">空欄</option>
            </select></label>
            <button type="button" onClick={() => moveSegment(place, segment.id, -1)} disabled={!index} aria-label="前へ移動">↑</button>
            <button type="button" onClick={() => moveSegment(place, segment.id, 1)} disabled={index === segments.length - 1} aria-label="後ろへ移動">↓</button>
            <button className="danger" type="button" onClick={() => deleteSegment(place, segment)}>削除</button>
          </div>
          {segment.type === 'blank' ? <>
            <div className="editor-row">
              <label>空欄の重要度<select value={segment.stars ?? 0} onChange={event => changeSegment(place, segment.id, { stars: Number(event.target.value) })}>
                {[0, 1, 2, 3].map(stars => <option value={stars} key={stars}>{stars === 0 ? '★なし' : '★'.repeat(stars)}</option>)}
              </select></label>
              <label>対応する解答<select value={segment.answer_id ?? ''} onChange={event => linkAnswer(place, segment, event.target.value)}>
                {!answer && <option value="">解答がありません</option>}
                {draftAnswers.map(a => <option key={a.id} value={a.id}>{a.text || '（未入力）'} · {a.id.slice(-8)}</option>)}
              </select></label>
            </div>
            {answer ? <>
              <label>解答（原書の解答表記）<textarea rows={2} value={answer.text} onChange={event => updateAnswer(answer.id, { text: event.target.value })} /></label>
              <label>空欄に入る文字<textarea rows={1} value={answer.fill_text ?? answer.text} onChange={event => updateAnswer(answer.id, { fill_text: event.target.value })} /></label>
              <small>例：本文に「万年前」がある場合、解答「700万年前」に対して空欄は「700」。空欄を赤字へ戻すと、この文字を使います。</small>
            </> : <button type="button" onClick={() => replaceSegment(place, segment.id, [makeBlank(segment)])}>解答を追加</button>}
          </> : <>
            <label>文字（改行も保存されます）<textarea rows={3} value={segment.text ?? ''}
              onSelect={event => { selection.current[segment.id] = [event.currentTarget.selectionStart, event.currentTarget.selectionEnd]; }}
              onChange={event => changeSegment(place, segment.id, { text: event.target.value })} /></label>
            <div className="editor-row selection-tools">
              <span>選択した文字を</span>
              <button type="button" onClick={() => splitSelection(place, segment, 'red_text')}>赤字に</button>
              <button type="button" onClick={() => splitSelection(place, segment, 'text')}>黒字に</button>
              <button type="button" onClick={() => splitSelection(place, segment, 'blank')}>空欄に</button>
            </div>
          </>}
          <details><summary>文字サイズ・強調・字下げ</summary><div className="editor-row">
            <label>文字サイズ<select value={String(segment.style?.size ?? 'body')} onChange={event => changeSegment(place, segment.id, { style: { ...segment.style, size: event.target.value } })}>
              <option value="body">標準</option><option value="small">小</option><option value="large">大</option>
            </select></label>
            <label>字下げ<select value={Number(segment.style?.indent ?? 0)} onChange={event => changeSegment(place, segment.id, { style: { ...segment.style, indent: Number(event.target.value) } })}>
              {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}文字</option>)}
            </select></label>
            <label><input type="checkbox" checked={Boolean(segment.style?.bold)} onChange={event => changeSegment(place, segment.id, { style: { ...segment.style, bold: event.target.checked } })} />太字</label>
            <label><input type="checkbox" checked={Boolean(segment.style?.underline)} onChange={event => changeSegment(place, segment.id, { style: { ...segment.style, underline: event.target.checked } })} />下線</label>
          </div></details>
        </fieldset>;
      })}
      <div className="editor-row">
        <button type="button" onClick={() => editSegments(place, [...segments, { id: uid('t'), type: 'text', text: '', style: { color: 'black', size: 'body' } }])}>＋ 文字を追加</button>
        <button type="button" onClick={() => editSegments(place, [...segments, makeBlank({ id: uid('b'), type: 'text', text: '', style: {} })])}>＋ 空欄と解答</button>
      </div>
    </div>;
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="modal-header"><div><small>原本を残したまま、自分の教材へ</small><h2 id="editor-title">問題 {question.printed_number} を編集</h2></div><button type="button" aria-label="編集を閉じる" onClick={close}>閉じる</button></div>
      <div className="modal-body">
        <p className="muted">問題ID・間違い履歴は維持されます。文字を選択すると、その範囲だけ赤字や空欄へ変更できます。</p>
        <details className="original"><summary>原文と元の解答を確認</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{original.segments.map(s => s.type === 'blank' ? `［${originalAnswers.find(a => a.id === s.answer_id)?.text ?? '解答なし'}］` : s.text ?? '').join('')}</p>
          {original.notes.map(note => <p key={note.id} style={{ whiteSpace: 'pre-wrap' }}>{note.marker} {note.segments.map(s => s.type === 'blank' ? `［${originalAnswers.find(a => a.id === s.answer_id)?.text ?? '解答なし'}］` : s.text ?? '').join('')}</p>)}
          <small>原本ID: {original.id}</small>
        </details>
        <label>問題の重要度<select value={draft.importance_stars ?? ''} onChange={event => { setDirty(true); setDraft(current => ({ ...current, importance_stars: event.target.value === '' ? null : Number(event.target.value) })); }}>
          <option value="">未設定</option>{[0, 1, 2, 3].map(stars => <option key={stars} value={stars}>{stars === 0 ? '★なし' : '★'.repeat(stars)}</option>)}
        </select></label>
        <h3>問題文</h3>{renderSegments({})}
        <h3>補足説明</h3>
        {draft.notes.map((note, index) => <section className="note-editor" key={note.id}>
          <div className="editor-row"><strong>補足 {index + 1}</strong><label>記号<input value={note.marker ?? ''} onChange={event => updateNote(note.id, { marker: event.target.value })} /></label><button type="button" className="danger" onClick={() => deleteNote(note)}>補足を削除</button></div>
          {renderSegments({ note: note.id })}
        </section>)}
        <button type="button" onClick={addNote}>＋ 補足説明を追加</button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button type="button" onClick={close}>キャンセル</button><button type="button" className="primary" onClick={save}>変更を保存</button></div>
    </section>
  </div>;
}
