import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Answer, Segment, Style } from './model';

type Props = {
  segments: Segment[]; answers: Answer[]; allVisible: boolean;
  revealed: Set<string>; onToggle: (id: string) => void;
};

export function segmentStyle(style?: Style): CSSProperties {
  if (!style) return {};
  const fontSize = style.size === 'small' ? '.84em' : style.size === 'large' ? '1.16em' : undefined;
  const indent = typeof style.indent === 'number' ? `${Math.max(0, Math.min(10, style.indent))}em` :
    typeof style.indent === 'string' && /^\d+(\.\d+)?(em|px|rem)$/.test(style.indent) ? style.indent : undefined;
  return { fontSize, fontWeight: style.bold ? 700 : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    marginInlineStart: indent, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
}

function AnswerPopup({anchor,answer,onClose,closing}: {anchor: RefObject<HTMLButtonElement | null>;answer:Answer;onClose:()=>void;closing:boolean}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position,setPosition] = useState({left:12,top:12,width:280,ready:false});
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.current || !popup.current) return;
      const viewport = window.visualViewport;
      const width = Math.min(320,(viewport?.width ?? window.innerWidth)-24);
      const r = anchor.current.getBoundingClientRect();
      const p = popup.current.getBoundingClientRect();
      const viewLeft = viewport?.offsetLeft ?? 0, viewTop = viewport?.offsetTop ?? 0;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const left = Math.max(viewLeft+12,Math.min(r.left+r.width/2-width/2,viewLeft+(viewport?.width??window.innerWidth)-width-12));
      const top = Math.max(viewTop+10,Math.min(r.top-p.height-10,viewTop+viewHeight-p.height-10));
      setPosition(previous => previous.left===left && previous.top===top && previous.width===width && previous.ready ? previous : {left,top,width,ready:true});
    };
    place();
    const resizeObserver = new ResizeObserver(place);
    if (popup.current) resizeObserver.observe(popup.current);
    window.addEventListener('scroll',place,{passive:true,capture:true});
    window.addEventListener('resize',place);
    window.visualViewport?.addEventListener('resize',place);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll',place,true);
      window.removeEventListener('resize',place);
      window.visualViewport?.removeEventListener('resize',place);
    };
  },[anchor,answer.text]);
  return createPortal(<div ref={popup} className={`answer-popup ${closing?'closing':''}`} role="tooltip"
    style={{position:'fixed',left:position.left,top:position.top,width:position.width,maxWidth:'calc(100vw - 24px)',maxHeight:'min(52vh, 420px)',overflowY:'auto',zIndex:80,visibility:position.ready?'visible':'hidden',boxSizing:'border-box',overflowWrap:'anywhere'}}
    onClick={event=>event.stopPropagation()}>
    <div className="answer-popup-label">解答<button type="button" aria-label="解答を閉じる" onClick={onClose}>×</button></div>
    <div className="answer-popup-text">{answer.text}</div>
    {answer.fill_text !== undefined && answer.fill_text !== answer.text && <div className="answer-popup-fill">空欄に入る部分：{answer.fill_text}</div>}
  </div>,document.body);
}

function Blank({segment,answer,open,allVisible,onToggle}: {segment:Segment;answer?:Answer;open:boolean;allVisible:boolean;onToggle:()=>void}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [present,setPresent]=useState(open);
  useEffect(()=>{
    if(open){setPresent(true);return;}
    const timer=window.setTimeout(()=>setPresent(false),130);
    return ()=>window.clearTimeout(timer);
  },[open]);
  // Reserve the same text area in every mode so revealing answers never moves surrounding text.
  const reserve = answer ? (answer.fill_text ?? answer.text) : '解答未登録';
  return <span className="blank-wrap" style={{display:'inline-block',maxWidth:'100%',verticalAlign:'baseline'}}>
    <button ref={anchor} type="button" className={`blank ${allVisible?'bulk-visible':''} ${open?'is-open':''}`}
      aria-label={allVisible?`解答：${reserve}`:open?'解答を閉じる':`空欄の解答を表示、重要度${segment.stars??0}`}
      aria-expanded={open || allVisible} onClick={onToggle} style={{...segmentStyle(segment.style),maxWidth:'100%',position:'relative',verticalAlign:'baseline'}}>
      <span className="blank-reserve" aria-hidden="true" style={{visibility:allVisible?'visible':'hidden',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{reserve}</span>
      {!allVisible && <span className="blank-stars" aria-hidden="true" style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>{'★'.repeat(Math.max(0,Math.min(3,segment.stars??0))) || '…'}</span>}
    </button>
    {(open || present) && !allVisible && answer && <AnswerPopup anchor={anchor} answer={answer} onClose={onToggle} closing={!open}/>}
    {open && !allVisible && !answer && <span className="missing-answer" role="status">解答の対応が見つかりません</span>}
  </span>;
}

export function Segments({segments,answers,allVisible,revealed,onToggle}: Props) {
  return <>{segments.map(segment => {
    const style=segmentStyle(segment.style);
    if (segment.type==='blank') {
      // Resolve by the explicit answer ID only; never use position or infer another question's answer.
      const answer=answers.find(candidate=>candidate.id===segment.answer_id && candidate.blank_id===segment.id);
      return <Blank key={segment.id} segment={segment} answer={answer} open={revealed.has(segment.id)} allVisible={allVisible} onToggle={()=>onToggle(segment.id)}/>;
    }
    if (segment.type==='line_break' || segment.type==='break') return <br key={segment.id}/>;
    if (segment.type==='red_text' || segment.style?.color==='red') {
      const visible=allVisible||revealed.has(segment.id);
      return <button key={segment.id} type="button" className={`red-segment ${visible?'revealed':'masked'}`} style={{...style,color:visible?'var(--red, #a53636)':'transparent'}}
        aria-label={visible?`${segment.text??''}を隠す`:'赤字を表示'} aria-pressed={visible} onClick={()=>onToggle(segment.id)}>
        <span aria-hidden={!visible}>{segment.text??''}</span>
      </button>;
    }
    return <span key={segment.id} style={style}>{segment.text??''}</span>;
  })}</>;
}
