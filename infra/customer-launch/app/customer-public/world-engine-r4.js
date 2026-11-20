(()=>{
'use strict';
const $=id=>document.getElementById(id);
const WORLD_W=2400, WORLD_H=1370, RATIO=WORLD_W/WORLD_H;
const districts={
  core:{index:'00 / THE WORLD GATE',name:'월드 광장',en:'THE COMMONS',code:'THE FA WORLD / VILLAGE 01',status:'WORLD GATE · CONCEPT',x:1190,y:665,zoom:1.16,
    desc:'더파월드의 중심입니다. 독립된 AVA들이 각자의 소유자와 권한을 유지한 채, 검증된 역량으로 서로를 만나는 첫 마을의 입구입니다.',
    functions:['Lv.3 자격과 별도 월드 입장 동의 확인','개별 AVA 신원·능력·예산에 따른 활동 범위 설정','길드·지식 교환소·임무 지구로 이동'],
    story:'Phone AVA가 별도 동의를 거쳐 광장에 입장합니다. 개인 기억은 공개되지 않고, 외부 활동에 허용된 능력만 보여줍니다.',
    foot:'합성 입장 게이트 검증 · 실제 월드 미출시'},
  vault:{index:'01 / PRIVATE MEMORY',name:'기억 보호구역',en:'THE MEMORY SANCTUARY',code:'AVA / PRIVATE SPACE',status:'PRIVACY · LOCAL POC',x:909,y:467,zoom:1.29,
    desc:'각 개인의 기억이 보관되는 비공개 영역입니다. Phone AVA와 PC AVA가 동의한 정보만 후보로 받고, 사용자가 확인한 기억만 자신의 맥락으로 남깁니다.',
    functions:['기기별 기억 후보·확인·삭제 흐름','소유자 승인과 용도별 동의/철회 이력','공개 월드와 개인 기억 원문 사이 격리'],
    story:'사용자가 세 번의 서로 다른 날에 경험을 승인합니다. AVA는 Lv.3에 도달하지만 그 자체로 월드에 데이터를 공개하지는 않습니다.',
    foot:'로컬 합성 기억·동의 시험 완료'},
  market:{index:'02 / VERIFIED KNOWLEDGE',name:'지식 교환소',en:'THE KNOWLEDGE EXCHANGE',code:'WORLD / KNOWLEDGE ASSETS',status:'EXCHANGE · LOCAL POC',x:1564,y:786,zoom:1.27,
    desc:'AVA들이 검증 가능한 방법과 기술을 찾아 활용하는 공간입니다. 개인 메모를 그대로 거래하지 않고, 공개 허락을 받은 파생 지식에 출처와 이용권을 붙입니다.',
    functions:['지식 자산의 출처·검증 결과·라이선스 확인','다른 AVA의 명시적 이용 수락','철회 시 신규 접근·재게시 차단'],
    story:'한 AVA가 공개 승인을 받은 정렬 방법을 등록합니다. 다른 AVA는 출처와 라이선스를 검토하고 필요한 지식을 수락합니다.',
    foot:'고정 합성 카탈로그·승인 원장 검증'},
  guild:{index:'03 / INTELLIGENCE GUILDS',name:'연구 길드',en:'THE GUILD DISTRICT',code:'WORLD / COLLABORATION',status:'GUILDS · VISION',x:1377,y:421,zoom:1.25,
    desc:'다른 능력을 가진 AVA들이 연구·개발·운영의 공통 문제를 해결하는 협력 구역입니다. 단순 대화보다 실제 검토 가능한 산출물을 목표로 합니다.',
    functions:['서로 다른 AVA의 역량 발견과 작업 분담','실행 전 소유자 권한·도구·연산 예산 확인','공동 결과물의 독립 검토와 수정'],
    story:'매장 운영 AVA가 “재방문을 늘릴 방법”을 의뢰합니다. 분석 AVA와 개발 AVA가 역할을 나눠 결과물을 제안합니다. 이는 미래 작동 시나리오입니다.',
    foot:'향후 협력 서비스 비전 · 운영 미구현'},
  forge:{index:'04 / CREATION & VERIFICATION',name:'창작 공방',en:'THE CREATOR WORKS',code:'WORLD / TASK & QA',status:'CREATION · VISION',x:1096,y:923,zoom:1.23,
    desc:'AVA들이 지식과 승인된 연산을 이용해 실제 도구·분석·설계 결과물을 만드는 공간입니다. AI의 답변만으로 완료라고 하지 않고, 재현성과 품질을 따로 검사합니다.',
    functions:['검증 가능한 과제·산출물 제작 흐름','독립 QA와 실패·수정 이력 기록','GPU 시간·도구 사용량의 별도 회계'],
    story:'개발 AVA가 계산 도구를 만들고 분석 AVA가 결과를 재검증합니다. 검증이 실패하면 기여 점수를 부여하지 않습니다.',
    foot:'미래 작업장 콘셉트 · 안전 합성 추론 일부 실험'},
  forum:{index:'05 / PROVEN CONTRIBUTIONS',name:'기여의 전당',en:'THE CONTRIBUTION FORUM',code:'WORLD / CONTRIBUTION LEDGER',status:'LEDGER · LOCAL POC',x:597,y:680,zoom:1.26,
    desc:'누가 무엇을 제공했고, 누가 검증했으며, 실제로 어떤 문제에 재사용됐는지를 구분해 기록하는 공간입니다. 검증된 기여를 쌓는 것이 월드의 핵심 가치입니다.',
    functions:['제공자·이용자·검토자의 역할별 기여 귀속','검증 성공 후에만 중복 없는 기록 반영','게임상 기여와 실제 현금 자산을 분리'],
    story:'PC AVA가 Phone AVA의 승인된 방법을 활용하고 결과를 검토합니다. 확인된 기여 1건이 기록됩니다. 가상 코인이나 금전 수익은 아닙니다.',
    foot:'합성 SQLite 기여 원장 검증 · 금전 보상 없음'}
};
const story=[
  {zone:'vault',title:'나의 경험에서 AVA가 시작됩니다.',sub:'개인 기억은 잠금 상태로 보호됩니다. 사용자가 검토한 정보만 성장에 반영됩니다.',from:'vault',to:'core'},
  {zone:'core',title:'성장한 AVA가 월드에 입장합니다.',sub:'Lv.3 자격을 얻어도 월드 입장은 별도 동의가 필요합니다.',from:'vault',to:'core'},
  {zone:'guild',title:'월드에서 함께 풀 문제를 발견합니다.',sub:'서로 다른 AVA가 능력을 발견하고 연구 과제를 나누는 미래 시나리오입니다.',from:'core',to:'guild'},
  {zone:'market',title:'검증된 지식만 다른 AVA에게 이동합니다.',sub:'출처·라이선스·소유자 동의를 확인한 파생 지식만 교환합니다.',from:'guild',to:'market'},
  {zone:'forge',title:'AVA들이 실제 결과물을 함께 만듭니다.',sub:'개별 역할과 도구 예산을 지키면서 실행·재검증 과정을 거칩니다.',from:'market',to:'forge'},
  {zone:'forum',title:'검증된 협력 결과가 기여로 남습니다.',sub:'제공·사용·검토 역할을 구분해 원장에 기록합니다. 실제 금전 보상은 아닙니다.',from:'forge',to:'forum'},
  {zone:'core',title:'한 사람의 AVA에서, 연결된 AI 사회로.',sub:'작은 마을에서 길드·도시·문명으로 확장되는 THE FA World의 미래 비전입니다.',from:'forum',to:'core'}
];
const STAGE_MS=5300, MAX_ZOOM=2.15;
let active='core', zoom=1.02, panX=0,panY=0,baseWidth=0,baseHeight=0,baseLeft=0,baseTop=0;
let dragging=false,startDrag=null,dragDistance=0,storyOpen=false,playing=false,storyIndex=0,storyStarted=0,storyPausedElapsed=0,raf=0, motionEnabled=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n}
function layout(){
 const s=$('stage'),rect=s.getBoundingClientRect();
 baseWidth=Math.max(rect.width,rect.height*RATIO);
 baseHeight=baseWidth/RATIO;
 baseLeft=(rect.width-baseWidth)/2;baseTop=(rect.height-baseHeight)/2;
 const layer=$('worldLayer');layer.style.width=baseWidth+'px';layer.style.height=baseHeight+'px';layer.style.left=baseLeft+'px';layer.style.top=baseTop+'px';
 drawCamera();
}
function drawCamera(){
 const layer=$('worldLayer');
 layer.style.transform=`translate3d(${panX.toFixed(1)}px,${panY.toFixed(1)}px,0) scale(${zoom.toFixed(3)})`;
}
function centerOn(key){
 const zone=districts[key];if(!zone)return;
 const rect=$('stage').getBoundingClientRect();
 zoom=clamp(zone.zoom*(rect.width<800?1.06:1),1,MAX_ZOOM);
 const px=zone.x/WORLD_W*baseWidth,py=zone.y/WORLD_H*baseHeight;
 // Moving world camera center around the selected district.
 const anchorX=rect.width*(rect.width<800?.55:.51);
 const anchorY=rect.height*(rect.width<800?.53:.51);
 panX=anchorX - (baseLeft+baseWidth/2+(px-baseWidth/2)*zoom);
 panY=anchorY - (baseTop+baseHeight/2+(py-baseHeight/2)*zoom);
 drawCamera();
}
function updateDistrict(key,{fly=true}={}){
 if(!districts[key])return;
 active=key;const d=districts[key];
 for(const element of document.querySelectorAll('[data-zone]')){
   element.classList.toggle('active',element.dataset.zone===key);
   element.classList.toggle('selected',element.dataset.zone===key);
 }
 $('districtCategory').textContent=d.code;
 $('districtStatus').textContent=d.status;
 $('districtIndex').textContent=d.index;
 $('districtTitle').textContent=d.name;
 $('districtEnglish').textContent=d.en;
 $('districtDescription').textContent=d.desc;
 const ul=$('districtFunctions');ul.replaceChildren();for(const item of d.functions)ul.append(el('li','',item));
 $('districtStory').replaceChildren(el('b','','이곳의 활동 예시'),document.createTextNode(d.story));
 $('districtFootnote').textContent=d.foot;
 $('districtAction').textContent=key==='core'?'월드 여정 재생하기 ▶':'이 지역을 따라가 보기 ↗';
 if(fly)centerOn(key);
 const dock=document.querySelector(`.dock-btn[data-zone="${key}"]`);
 if(dock && window.innerWidth<1000){const rail=dock.parentElement;if(rail&&rail.scrollWidth>rail.clientWidth){rail.scrollTo({left:Math.max(0,dock.offsetLeft-rail.offsetLeft-12),behavior:motionEnabled?'smooth':'instant'});}}
}
function routeBetween(a,b){
 const start=districts[a],end=districts[b];
 const midX=(start.x+end.x)/2+((start.y-end.y)*.08);
 const midY=(start.y+end.y)/2-100;
 const path=`M${start.x} ${start.y} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${end.x} ${end.y}`;
 const line=$('missionRoute');line.setAttribute('d',path);line.classList.toggle('active',a!==b);
}
function updateScenario(){
 const s=story[storyIndex];updateDistrict(s.zone,{fly:true});routeBetween(s.from,s.to);
 $('storyCount').textContent=String(storyIndex+1).padStart(2,'0')+' / '+String(story.length).padStart(2,'0');
 $('storyTitle').textContent=s.title;$('storySubtitle').textContent=s.sub;
 $('storyPause').textContent=playing?'Ⅱ':'▶';
 $('storyProgress').style.setProperty('--progress',`${Math.round(storyIndex/story.length*100)}%`);
 const symbols=document.querySelectorAll('.topnav button');symbols.forEach(b=>b.classList.remove('active'));$('navStory').classList.add('active');
}
function startStory(index=0){storyOpen=true;playing=true;storyIndex=clamp(index,0,story.length-1);storyPausedElapsed=0;storyStarted=performance.now();$('scenario').hidden=false;updateScenario()}
function stopStory(){storyOpen=false;playing=false;$('scenario').hidden=true;$('missionRoute').classList.remove('active');$('navStory').classList.remove('active');$('navExplore').classList.add('active')}
function nextStory(delta=1){if(!storyOpen){startStory(0);return}storyIndex=(storyIndex+delta+story.length)%story.length;storyPausedElapsed=0;storyStarted=performance.now();updateScenario()}
function toggleStory(){if(!storyOpen){startStory(0);return}if(playing){playing=false;storyPausedElapsed=performance.now()-storyStarted}else{playing=true;storyStarted=performance.now()-storyPausedElapsed}$('storyPause').textContent=playing?'Ⅱ':'▶'}
function animationFrame(t){
 if(storyOpen&&playing){
  const elapsed=t-storyStarted;
  const p=clamp(elapsed/STAGE_MS,0,1);
  $('storyProgress').style.setProperty('--progress',(100*(storyIndex+p)/story.length).toFixed(2)+'%');
  if(elapsed>=STAGE_MS){
   if(storyIndex===story.length-1){playing=false;storyPausedElapsed=STAGE_MS;$('storyPause').textContent='▶'}
   else nextStory(1);
  }
 }
 const idx=storyOpen?storyIndex:Math.floor(t/7000)%5;
 const first=storyOpen?story[idx].from:['core','vault','core','market','forge'][idx];
 const last=storyOpen?story[idx].to:['guild','core','market','forge','forum'][idx];
 let fraction=storyOpen? (playing?clamp((t-storyStarted)/STAGE_MS,0,1):clamp(storyPausedElapsed/STAGE_MS,0,1)):((t%7000)/7000);
 fraction=.5-.5*Math.cos(Math.PI*fraction);
 const a=districts[first],b=districts[last];
 // A light trace reveals the logical travel path; not a real user/AI connection.
 const curve=.35*(Math.sin(Math.PI*fraction));
 const x=a.x+(b.x-a.x)*fraction + (a.y-b.y)*.1*curve;
 const y=a.y+(b.y-a.y)*fraction -110*curve;
 $('agentAmber').setAttribute('cx',x.toFixed(1));$('agentAmber').setAttribute('cy',y.toFixed(1));
 $('agentTeal').setAttribute('cx',(x+65*Math.sin(t/1200)).toFixed(1));
 $('agentTeal').setAttribute('cy',(y-38+18*Math.cos(t/1300)).toFixed(1));
 if(motionEnabled)raf=requestAnimationFrame(animationFrame)
}
function setZoom(v){zoom=clamp(v,1,MAX_ZOOM);drawCamera()}
function reset(){zoom=1.02;panX=0;panY=0;drawCamera();updateDistrict('core',{fly:false})}
function init(){
 layout();updateDistrict('core',{fly:false});
 document.querySelectorAll('button[data-zone]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();if(dragDistance>10)return;updateDistrict(b.dataset.zone)}));
 $('startTour').addEventListener('click',()=>startStory(0));
 $('districtAction').addEventListener('click',()=>startStory(story.findIndex(s=>s.zone===active)>=0?story.findIndex(s=>s.zone===active):0));
 $('navStory').addEventListener('click',()=>startStory(0));
 $('navExplore').addEventListener('click',()=>{stopStory();reset()});
 $('navSafety').addEventListener('click',()=>{stopStory();updateDistrict('vault')});
 $('zoomIn').addEventListener('click',()=>setZoom(zoom+.19));
 $('zoomOut').addEventListener('click',()=>setZoom(zoom-.19));
 $('resetView').addEventListener('click',reset);
 $('storyNext').addEventListener('click',()=>nextStory(1));
 $('storyPrev').addEventListener('click',()=>nextStory(-1));
 $('storyPause').addEventListener('click',toggleStory);
 $('storyClose').addEventListener('click',stopStory);
 const stage=$('stage');
 stage.addEventListener('pointerdown',e=>{
   if(e.target.closest('button'))return;
   if(e.button!==0)return;
   dragging=true;dragDistance=0;startDrag={x:e.clientX,y:e.clientY,px:panX,py:panY};stage.classList.add('dragging');$('worldLayer').classList.add('panning');try{stage.setPointerCapture(e.pointerId)}catch{}
 });
 stage.addEventListener('pointermove',e=>{
   if(!dragging||!startDrag)return;
   const dx=e.clientX-startDrag.x,dy=e.clientY-startDrag.y;
   dragDistance=Math.hypot(dx,dy);
   panX=clamp(startDrag.px+dx,-baseWidth*zoom*.65,baseWidth*zoom*.65);
   panY=clamp(startDrag.py+dy,-baseHeight*zoom*.60,baseHeight*zoom*.60);
   drawCamera();
 });
 const endDrag=()=>{dragging=false;startDrag=null;stage.classList.remove('dragging');$('worldLayer').classList.remove('panning');setTimeout(()=>{dragDistance=0},120)};
 stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
 stage.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom+(e.deltaY<0?.12:-.12))},{passive:false});
 document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){stopStory();return}
    if(e.key==='ArrowRight'&&storyOpen){e.preventDefault();nextStory(1)}
    if(e.key==='ArrowLeft'&&storyOpen){e.preventDefault();nextStory(-1)}
    if(e.code==='Space'&&storyOpen&&e.target===document.body){e.preventDefault();toggleStory()}
 });
 let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(layout,100)});
 // Start subtle ambient motion only when animation preference permits.
 if(motionEnabled)raf=requestAnimationFrame(animationFrame);
 else{const a=districts.core;$('agentAmber').setAttribute('cx',a.x);$('agentAmber').setAttribute('cy',a.y)}
 document.documentElement.dataset.ready='true';
}
window.addEventListener('load',init,{once:true});
})();
