'use strict';
(() => {
 const get = name => document.getElementById(name);
 const state = { mode:'ppt', invalid:false, generated:false };
 const themes = {
  dark:{ bg:'0C0D0E', panel:'201E1A', text:'F3F0EB', muted:'B7AFA5', accent:'DFC29D', ink:'0C0D0E' },
  ivory:{ bg:'F7F3EA', panel:'E8DECE', text:'29231C', muted:'6B5F53', accent:'9E6E39', ink:'FFFFFF' },
  charcoal:{ bg:'16181A', panel:'292722', text:'F6F1E8', muted:'C3B4A5', accent:'C9A875', ink:'131517' }
 };
 const hex = value => '#' + value;
 const nameSafe = text => (text.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,'_').slice(0,54) || 'thefa_core');
 function readData(){
  const title=get('work-title').value.trim();
  const subtitle=get('work-subtitle').value.trim();
  const items=get('work-lines').value.split(/\r?\n/).map(v=>v.trim().replace(/^\s*[-•·]\s*/, '')).filter(Boolean);
  if(title.length < 2) throw new Error('제목을 두 글자 이상 입력해 주세요.');
  if(items.length===0) throw new Error('내용을 한 줄 이상 입력해 주세요.');
  if(items.length > 20) throw new Error('핵심 내용은 최대 20개까지 입력할 수 있습니다.');
  if(items.some(item=>item.length>100)) throw new Error('한 항목이 100자를 넘지 않도록 나누어 주세요.');
  const density=Number(get('slide-density').value);
  return {title,subtitle,items,density,theme:get('visual-style').value};
 }
 const chunks=(items,n)=>{let out=[];for(let i=0;i<items.length;i+=n)out.push(items.slice(i,i+n));return out;};
 function setStatus(message,kind='info'){
  const el=get('studio-status');
  el.textContent=message;el.dataset.kind=kind;
 }
 function applyMode(){
  document.querySelectorAll('[data-mode]').forEach(b=>{
   const selected=b.dataset.mode===state.mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
  });
  const pic=state.mode==='image';
  get('editor-heading').textContent=pic?'이미지 문구와 구도 정하기':'발표자료 구성하기';
  get('editor-desc').textContent=pic?'확인한 문구를 조합해 실제 PNG·SVG 이미지 파일을 만듭니다. 사진을 생성하는 AI 모델은 아직 연결되어 있지 않습니다.':'정확한 내용을 입력하면 실제 편집 가능한 PPTX 파일을 만듭니다. 확인되지 않은 자료는 자동으로 생성하지 않습니다.';
  get('field-help').textContent=pic?'첫 번째 항목부터 4개를 카드형 메시지로 이미지에 배치합니다. 작성한 정보만 사용합니다.':'한 줄이 슬라이드의 핵심 항목이 됩니다. 최대 20개, 한 항목 100자 이내.';
  get('slide-density').closest('div').hidden=pic;
  get('ppt-preview').hidden=pic;get('image-preview').hidden=!pic;
  get('export-ppt').hidden=pic;get('export-png').hidden=!pic;get('export-svg').hidden=!pic;
  get('preview-footnote').textContent=pic?'1600×900 PNG · 편집 가능한 SVG · 생성형 AI 이미지 아님':'16:9 와이드 PPTX · 미리보기는 표지 디자인 기준 · 각 슬라이드는 입력 내용으로 구성';
  updatePreview();
 }
 function paintCanvas(data){
  const canvas=get('image-preview');
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('이미지 미리보기를 지원하지 않는 브라우저입니다.');
  const t=themes[data.theme];
  const bg=ctx.createLinearGradient(0,0,1600,900);
  bg.addColorStop(0,hex(t.bg));bg.addColorStop(1,hex(t.panel));
  ctx.fillStyle=bg;ctx.fillRect(0,0,1600,900);
  ctx.globalAlpha=.18;ctx.strokeStyle=hex(t.accent);ctx.lineWidth=2;
  for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(1470,175,145+i*72,0,Math.PI*2);ctx.stroke();}
  ctx.globalAlpha=1;
  ctx.fillStyle=hex(t.accent);ctx.fillRect(94,120,83,6);
  ctx.font='700 28px Arial, sans-serif';ctx.letterSpacing='4px';ctx.fillText('THE FA  /  CORE',94,101);
  ctx.letterSpacing='0px';
  ctx.fillStyle=hex(t.text);ctx.font='700 91px Arial, "Malgun Gothic", sans-serif';
  const titleLines=data.title.length>18?[data.title.slice(0,18),data.title.slice(18,46)]:[data.title];
  titleLines.forEach((line,i)=>ctx.fillText(line,92,290+i*110,1380));
  ctx.fillStyle=hex(t.muted);ctx.font='31px Arial, "Malgun Gothic", sans-serif';
  const subY=titleLines.length===1?355:440;
  ctx.fillText(data.subtitle||'요청에서 결과물까지, 하나의 작업 흐름',98,subY,1250);
  const cards=data.items.slice(0,4),top=Math.max(510,subY+92);
  cards.forEach((item,i)=>{
   const col=i%2,row=Math.floor(i/2),x=96+col*715,y=top+row*116;
   ctx.fillStyle=hex(t.panel);ctx.globalAlpha=.92;ctx.fillRect(x,y,672,91);ctx.globalAlpha=1;
   ctx.fillStyle=hex(t.accent);ctx.fillRect(x,y,5,91);
   ctx.font='700 23px Arial, sans-serif';ctx.fillText(('0'+(i+1)).slice(-2),x+27,y+35);
   ctx.fillStyle=hex(t.text);ctx.font='600 25px Arial, "Malgun Gothic", sans-serif';
   ctx.fillText(item,x+84,y+54,552);
  });
  ctx.fillStyle=hex(t.muted);ctx.font='19px Arial, sans-serif';
  ctx.fillText('THE FA CORE  •  CREATED IN YOUR BROWSER',97,859);
  ctx.textAlign='right';ctx.fillText('1600 × 900  /  DRAFT',1500,859);ctx.textAlign='left';
 }
 function updatePreview(){
  let data;
  try{data=readData();state.invalid=false;}catch(e){
   state.invalid=true;get('preview-meta').textContent='내용 확인 필요';get('line-count').textContent='내용 확인';
   setStatus(e.message,'error');return;
  }
  get('line-count').textContent=data.items.length+'개 항목';
  const total=2+Math.ceil(data.items.length/data.density);
  get('preview-meta').textContent=state.mode==='ppt'?total+'장 구성':'1600 × 900';
  get('slide-preview-title').textContent=data.title;
  get('slide-preview-subtitle').textContent=data.subtitle||'요청에서 결과물까지 이어지는 작업 흐름';
  get('ppt-preview').className='ppt-preview theme-'+data.theme;
  if(state.mode==='image')paintCanvas(data);
  get('preview-desc').textContent=state.mode==='ppt'?'표지와 '+data.items.length+'개 핵심 항목으로 실제 슬라이드를 생성합니다.':'카드·문구의 배치를 보고 이미지 파일을 내보내세요.';
  setStatus('구성 내용 확인 완료 · 파일 다운로드를 시작할 수 있습니다.','ready');
 }
 function setSlideBackground(pptx,slide,t){
  slide.background={color:t.bg};
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:0.13,h:7.5,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
 }
 function slideText(slide,title,sub,t,number){
  slide.addText('THE FA  /  CORE',{x:.67,y:.35,w:6.2,h:.3,fontFace:'Arial',fontSize:10,bold:true,color:t.accent,charSpacing:3,margin:0});
  slide.addText(String(number).padStart(2,'0')+'  /  PRESENTATION',{x:9.45,y:.39,w:3.1,h:.25,fontFace:'Arial',fontSize:8,color:t.muted,align:'right',margin:0});
  slide.addText(title,{x:.68,y:1.25,w:11.88,h:1.65,fontFace:'Malgun Gothic',fontSize:32,bold:true,color:t.text,breakLine:false,margin:0,fit:'shrink',valign:'mid'});
  if(sub)slide.addText(sub,{x:.72,y:3.2,w:11.7,h:.85,fontFace:'Malgun Gothic',fontSize:16,color:t.muted,margin:0,fit:'shrink'});
  slide.addShape('line',{x:.72,y:6.95,w:11.82,h:0,line:{color:t.accent,width:1,transparency:50}});
  slide.addText('THE FA CORE  •  REVIEWED USER CONTENT',{x:.72,y:7.06,w:9,h:.22,fontSize:8,color:t.muted,margin:0});
 }
 async function downloadPpt(){
  let data;
  try{data=readData();}catch(e){setStatus(e.message,'error');return;}
  if(typeof window.PptxGenJS!=='function'){setStatus('PPTX 제작 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.','error');return;}
  const btn=get('export-ppt');btn.disabled=true;setStatus('PPTX 파일을 구성하고 있습니다.','busy');
  try{
   const pptx=new window.PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='THE FA Core';pptx.subject='사용자가 확인한 내용으로 작성한 문서';pptx.title=data.title;pptx.lang='ko-KR';
   const t=themes[data.theme],cover=pptx.addSlide();setSlideBackground(pptx,cover,t);
   slideText(cover,data.title,data.subtitle||'작성·검토한 내용으로 만든 파일',t,1);
   const sets=chunks(data.items,data.density);
   for(let i=0;i<sets.length;i++){
    const slide=pptx.addSlide();setSlideBackground(pptx,slide,t);
    slide.addText('THE FA CORE   /   KEY POINTS',{x:.68,y:.39,w:9,h:.28,fontFace:'Arial',fontSize:10,color:t.accent,bold:true,charSpacing:2,margin:0});
    slide.addText((i+2).toString().padStart(2,'0')+'  /  '+(sets.length+2),{x:9.5,y:.4,w:3,h:.24,fontFace:'Arial',fontSize:8,color:t.muted,align:'right',margin:0});
    slide.addText('핵심 내용 '+(i+1),{x:.68,y:1.06,w:11.5,h:.8,fontFace:'Malgun Gothic',fontSize:28,bold:true,color:t.text,margin:0});
    sets[i].forEach((item,k)=>{
     const y=2.02+k*.89;
     slide.addShape(pptx.ShapeType.rect,{x:.72,y:y+.17,w:.095,h:.095,fill:{color:t.accent},line:{color:t.accent}});
     slide.addText(item,{x:.99,y,w:11.28,h:.7,fontFace:'Malgun Gothic',fontSize:17,color:t.text,margin:0,fit:'shrink',valign:'mid'});
    });
    slide.addText('SOURCE  /  USER-REVIEWED INPUT',{x:.72,y:7.01,w:10,h:.2,fontFace:'Arial',fontSize:8,color:t.muted,margin:0});
   }
   const end=pptx.addSlide();setSlideBackground(pptx,end,t);
   slideText(end,'감사합니다','THE FA Core · 다음 작업으로 이어가기',t,sets.length+2);
   const name=nameSafe(data.title)+'_THEFA_CORE.pptx';
   await pptx.writeFile({fileName:name,compression:true});
   setStatus('PPTX 생성 요청이 완료됐습니다. 브라우저의 다운로드 목록에서 '+name+' 파일을 확인하세요.','ready');
   state.generated=true;
  }catch(error){console.error('PPTX_LOCAL_EXPORT_FAILED');setStatus('PPTX 파일을 만들지 못했습니다. 입력 내용을 다시 확인해 주세요.','error');}
  finally{btn.disabled=false;}
 }
 function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 function downloadPng(){
  let data;try{data=readData();paintCanvas(data);}catch(e){setStatus(e.message,'error');return;}
  const canvas=get('image-preview');
  setStatus('PNG 이미지를 저장하고 있습니다.','busy');
  canvas.toBlob(blob=>{
   if(!blob){setStatus('브라우저에서 PNG 파일 생성에 실패했습니다.','error');return;}
   downloadBlob(blob,nameSafe(data.title)+'_THEFA_CORE.png');
   setStatus('PNG 제작 완료 · 브라우저 다운로드 목록을 확인해 주세요.','ready');
   state.generated=true;
  },'image/png');
 }
 function xmlEscape(text){return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
 function svgData(data){
  const t=themes[data.theme];
  const lines=data.title.length>18?[data.title.slice(0,18),data.title.slice(18,46)]:[data.title];
  const texts=lines.map((x,i)=>'<text x="96" y="'+(290+i*110)+'" fill="'+hex(t.text)+'" font-family="Arial, sans-serif" font-weight="700" font-size="90">'+xmlEscape(x)+'</text>').join('');
  const cards=data.items.slice(0,4).map((x,i)=>{
   const cx=96+(i%2)*715,cy=510+Math.floor(i/2)*116;
   return '<rect x="'+cx+'" y="'+cy+'" width="672" height="91" fill="'+hex(t.panel)+'"/><rect x="'+cx+'" y="'+cy+'" width="5" height="91" fill="'+hex(t.accent)+'"/>'+
    '<text x="'+(cx+27)+'" y="'+(cy+40)+'" fill="'+hex(t.accent)+'" font-size="23" font-family="Arial">'+(i+1).toString().padStart(2,'0')+'</text>'+
    '<text x="'+(cx+84)+'" y="'+(cy+53)+'" fill="'+hex(t.text)+'" font-size="24" font-family="Arial, sans-serif" textLength="'+Math.min(x.length*24,530)+'" lengthAdjust="spacingAndGlyphs">'+xmlEscape(x)+'</text>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'+
   '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="'+xmlEscape(data.title)+'">'+
   '<rect width="1600" height="900" fill="'+hex(t.bg)+'"/><rect x="96" y="116" width="84" height="6" fill="'+hex(t.accent)+'"/>'+
   '<text x="96" y="95" fill="'+hex(t.accent)+'" font-family="Arial" font-weight="bold" font-size="28">THE FA / CORE</text>'+
   texts+'<text x="98" y="'+(lines.length===1?355:440)+'" fill="'+hex(t.muted)+'" font-family="Arial, sans-serif" font-size="30">'+xmlEscape(data.subtitle||'요청에서 결과물까지 이어지는 작업 흐름')+'</text>'+
   cards+'<text x="96" y="858" fill="'+hex(t.muted)+'" font-family="Arial" font-size="18">THE FA CORE  •  CREATED IN YOUR BROWSER</text></svg>';
 }
 function downloadSvg(){
  try{const data=readData(),svg=svgData(data);downloadBlob(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),nameSafe(data.title)+'_THEFA_CORE.svg');setStatus('SVG 파일 제작 완료 · 다운로드 목록에서 확인하세요.','ready');}
  catch(error){setStatus(error.message,'error');}
 }
 function makeDraft(){
  let data;try{data=readData()}catch(e){setStatus(e.message,'error');return;}
  const header=state.mode==='ppt'?'다음 내용을 바탕으로 발표자료를 만들기 위한 슬라이드 구성안을 작성해 주세요.':
    '다음 내용을 바탕으로 이미지 디자인의 문구와 시각 구성을 제안해 주세요.';
  const prompt=header+'\n\n제목: '+data.title+'\n설명: '+data.subtitle+'\n핵심 내용:\n- '+data.items.join('\n- ')+
   '\n\n확인되지 않은 사실·수치를 임의로 만들지 마세요. 파일이나 이미지가 이미 생성됐다고 말하지 마세요. 먼저 실제 사용 가능한 작업 범위와 부족한 자료를 구분해 주세요.';
  if(location.hostname.includes('thefa-core-chat-review')){
   if(navigator.clipboard?.writeText){navigator.clipboard.writeText(prompt).then(()=>setStatus('AI 요청문을 복사했습니다. 실제 thefacore.com 대화창에 붙여넣어 주세요.','ready'),()=>setStatus('복사에 실패했습니다. 내용을 직접 선택해 복사해 주세요.','error'));}
   else setStatus('이 브라우저에서는 자동 복사를 지원하지 않습니다. 운영 대화창에서 같은 내용을 입력해 주세요.','error');
   return;
  }
  try{sessionStorage.setItem('thefa_core_pending_prompt',prompt.slice(0,3900));window.location.assign('/');}
  catch{navigator.clipboard?.writeText(prompt).then(()=>setStatus('초안 요청문이 복사됐습니다. 대화창에 붙여넣어 주세요.','ready'),()=>setStatus('초안 이동에 실패했습니다. 내용을 직접 복사해 대화창에서 요청해 주세요.','error'));}
 }
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;applyMode();get('workbench').scrollIntoView({behavior:'smooth',block:'start'});}));
 ['work-title','work-subtitle','work-lines','visual-style','slide-density'].forEach(key=>{
  get(key).addEventListener('input',updatePreview);
  get(key).addEventListener('change',updatePreview);
 });
 get('studio-form').addEventListener('submit',e=>e.preventDefault());
 get('export-ppt').addEventListener('click',downloadPpt);
 get('export-png').addEventListener('click',downloadPng);
 get('export-svg').addEventListener('click',downloadSvg);
 get('draft-in-chat').addEventListener('click',makeDraft);
 if(location.hostname.includes('thefa-core-chat-review')){
  get('draft-in-chat').textContent='AI 요청문 복사';
  const help=document.querySelector('.action-explain');if(help)help.textContent='검토판은 AI 대화 서버에 연결하지 않습니다. 복사한 요청문을 실제 더파코어 대화창에 붙여넣어 주세요.';
  document.querySelectorAll('a[href="/"]').forEach(a=>{a.href='https://thefacore.com/';});
 }
 applyMode();
})();
