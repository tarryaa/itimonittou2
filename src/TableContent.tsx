import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Answer, Segment, SourceTable } from './model';
import { Segments } from './Segments';

type Props = { table: SourceTable; all: boolean; answers: Answer[] };
const metadata = new Set(['id','page_id','related_question_id','heading','title','status','type','source_image','page_side','source_area','blank_id','answer_id','figure_id']);
const labels: Record<string,string> = { cells:'図中の項目',items:'図中の項目',labels:'用語',features:'特徴',note:'注記',answer:'解答',label:'記号',key:'記号',text:'本文',summary:'補足' };
const isRecord = (v:unknown): v is Record<string,unknown> => v!==null && typeof v==='object' && !Array.isArray(v);

/** Render all supplied textual content; hide explicit answers without inventing answer links. */
export default function TableContent({table,all,answers}:Props) {
  const root=useRef<HTMLDetailsElement>(null);
  const [revealed,setRevealed]=useState(new Set<string>());
  useEffect(()=>{if(!all)setRevealed(new Set());},[all,table]);
  useEffect(()=>{
    if(all||!revealed.size)return;
    const observer=new IntersectionObserver(([entry])=>{if(!entry.isIntersecting)setRevealed(new Set());},{rootMargin:'650px 0px 650px 0px'});
    if(root.current)observer.observe(root.current);
    return ()=>observer.disconnect();
  },[all,revealed.size]);
  const toggle=(id:string)=>setRevealed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  const renderSegments=(segments:Segment[],matching:Answer[]=[]) => <Segments segments={segments} answers={matching} allVisible={all} revealed={revealed} onToggle={toggle}/>;
  const red=(value:unknown,path:string) => renderSegments([{id:`${table.id}-${path}`,type:'red_text',text:String(value??''),style:{color:'red'}}]);
  const value=(v:unknown,path:string,mask=false):ReactNode => {
    if(v===null||v===undefined)return null;
    if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return mask?red(v,path):String(v);
    if(Array.isArray(v))return <div className="table-items">{v.map((item,i)=><div key={i} className="table-item">{value(item,`${path}-${i}`,mask)}</div>)}</div>;
    if(!isRecord(v))return String(v);
    // Explicit IDs are the only permissible link between a table cell and an answer.
    const linked=typeof v.answer_id==='string' && typeof v.blank_id==='string'
      ?answers.find(a=>a.id===v.answer_id&&a.blank_id===v.blank_id):undefined;
    const hasAnswer=Object.hasOwn(v,'answer');
    return <div className="table-cell-content">
      {(v.label!==undefined||v.key!==undefined)&&<strong>{String(v.label??v.key)}　</strong>}
      {linked?renderSegments([{id:linked.blank_id,type:'blank',answer_id:linked.id,stars:0,style:{box:true}}],[linked]):hasAnswer?red(v.answer,`${path}-answer`):null}
      {linked&&hasAnswer&&String(v.answer)!==linked.text&&<div>図の記載：{red(v.answer,`${path}-source-answer`)}</div>}
      {Object.entries(v).filter(([k])=>!metadata.has(k)&&!['label','key','answer'].includes(k)).map(([k,item])=><div key={k} className="table-field"><span>{labels[k]??k}：</span>{value(item,`${path}-${k}`,mask||/^\d+$/.test(k))}</div>)}
    </div>;
  };
  const contentKeys=Object.keys(table).filter(k=>!metadata.has(k)&&!['columns','rows'].includes(k));
  const hasContent=!!table.rows?.length||!!table.columns?.length||contentKeys.length>0;
  return <details className="source-table" ref={root} open>
    <summary>{table.heading||table.title||'図表の文字情報'}</summary>
    {table.title&&table.heading&&table.title!==table.heading&&<p>{table.title}</p>}
    {(table.rows||table.columns)&&<table><thead><tr>{table.columns?.map((c,i)=><th key={i}>{value(c,`column-${i}`)}</th>)}</tr></thead><tbody>{table.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{value(cell,`row-${i}-${j}`)}</td>)}</tr>)}</tbody></table>}
    {contentKeys.map(k=><div key={k} className="table-field"><span>{labels[k]??k}：</span>{value(table[k],k)}</div>)}
    {!hasContent&&<p className="muted">この図表は表題のみ収録されています。図や文字情報の転記は未完了です。</p>}
  </details>;
}
