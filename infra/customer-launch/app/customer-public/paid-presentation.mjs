// Reuses the already bundled PptxGenJS browser vendor and THE FA Core's dark-gold theme.
// Draws only text from an actually completed AI result; never implies that research/approval happened.
const palette={bg:'111115',panel:'242226',accent:'D9B893',text:'F4EEE7',muted:'BFB1A9'};
function clean(line){return String(line??'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim();}
function segments(answer){
 const raw=String(answer??'').split(/\r?\n/).map(clean).filter(Boolean);
 const title=clean(raw.find(x=>x.startsWith('# '))?.replace(/^#\s*/,'')||'AI 업무 결과').slice(0,100);
 const lines=raw.filter(x=>!x.startsWith('---')).map(x=>x.replace(/^#{1,5}\s*/,'').replace(/^[-*•]\s*/,'')).filter(x=>x!==title);
 const slides=[];
 let section=[];
 for(const item of lines){
  const limited=item.slice(0,260);
  if(section.length>=5){slides.push(section);section=[];}
  section.push(limited);
 }
 if(section.length)slides.push(section);
 if(!slides.length)throw Error('PRESENTATION_NO_CONTENT');
 if(slides.length>24)throw Error('PRESENTATION_TOO_LONG_SPLIT_SOURCE');
 // Never silently discard the tail of the customer's completed AI result.
 return {title,slides};
}
function frame(pptx,slide,num,total,label){
 slide.background={color:palette.bg};
 slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:0.115,h:7.5,line:{color:palette.accent,transparency:100},fill:{color:palette.accent}});
 slide.addText('THE FA  /  CORE',{x:.65,y:.38,w:5,h:.29,fontFace:'Arial',bold:true,fontSize:11,color:palette.accent,charSpacing:2,margin:0});
 slide.addText(String(num).padStart(2,'0')+' / '+String(total).padStart(2,'0'),{x:10.55,y:.42,w:2.1,h:.25,fontSize:9,color:palette.muted,align:'right',margin:0});
 slide.addShape(pptx.ShapeType.line,{x:.66,y:6.88,w:12.02,h:0,line:{color:palette.accent,transparency:65,width:1}});
 slide.addText('AI 초안 · 원본 정보 확인 필요 · 외부 데이터 자동 검증 없음',
   {x:.68,y:7.01,w:12,h:.2,fontFace:'Malgun Gothic',fontSize:8,color:palette.muted,margin:0});
 if(label)slide.addText(label,{x:.68,y:.9,w:11.95,h:.58,fontFace:'Malgun Gothic',fontSize:24,bold:true,color:palette.text,margin:0,fit:'shrink'});
}
export async function saveAiPresentation(answer){
 if(typeof window.PptxGenJS!=='function')throw Error('PPTX_LIBRARY_NOT_READY');
 const {title,slides}=segments(answer);
 const pptx=new window.PptxGenJS();
 pptx.layout='LAYOUT_WIDE';pptx.author='THE FA Core';pptx.subject='실제 AI 생성 결과의 검토용 발표자료';pptx.title=title;pptx.lang='ko-KR';
 const total=slides.length+2;
 const cover=pptx.addSlide();frame(pptx,cover,1,total);
 cover.addText(title,{x:.72,y:1.78,w:11.6,h:1.5,fontFace:'Malgun Gothic',fontSize:36,bold:true,color:palette.text,margin:0,fit:'shrink',valign:'mid'});
 cover.addText('로컬 AI 생성 결과 · 검토용 발표자료',{x:.76,y:3.56,w:11.2,h:.56,fontFace:'Malgun Gothic',fontSize:17,color:palette.accent,margin:0});
 cover.addText('THE FA Core 고객용 기능형 시험판',{x:.76,y:5.9,w:11.2,h:.3,fontFace:'Malgun Gothic',fontSize:11,color:palette.muted,margin:0});
 for(let i=0;i<slides.length;i++){
  const slide=pptx.addSlide();frame(pptx,slide,i+2,total,'핵심 결과 '+(i+1));
  slides[i].forEach((line,k)=>{
   const y=1.72+k*.94;
   slide.addShape(pptx.ShapeType.rect,{x:.8,y:y+.17,w:.115,h:.115,fill:{color:palette.accent},line:{color:palette.accent}});
   slide.addText(line,{x:1.02,y,w:11.43,h:.79,fontFace:'Malgun Gothic',fontSize:15.5,
     color:palette.text,margin:0,breakLine:false,fit:'shrink',valign:'mid'});
  });
 }
 const last=pptx.addSlide();frame(pptx,last,total,total,'검토 및 다음 단계');
 last.addText('이 자료는 실제 로컬 AI가 작성한 결과의 편집 가능한 발표자료입니다.',
   {x:.77,y:2.05,w:11.3,h:.8,fontFace:'Malgun Gothic',fontSize:22,bold:true,color:palette.text,margin:0,fit:'shrink'});
 last.addText('외부 자료 조사는 수행하지 않았습니다.\n수치·인용·정책·개인정보·외부 게시 내용은 별도 확인이 필요합니다.',
   {x:.78,y:3.3,w:11.2,h:1.4,fontFace:'Malgun Gothic',fontSize:17,color:palette.muted,margin:0,breakLine:false});
 await pptx.writeFile({fileName:'THEFA_Core_AI_업무발표자료.pptx',compression:true});
 return {slides:total,title};
}
