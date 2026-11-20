import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const consoleHtml=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function getFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must exist`);
  const end=source.indexOf('\n}',start)+2;
  return source.slice(start,end);
}

test('email stays masked in default account display',()=>{
  const line=source.match(/function maskEmail[^\n]+/)[0];
  const context=vm.createContext({});
  vm.runInContext(line,context);
  assert.equal(context.maskEmail('ceo@thefa.kr'),'ce***@thefa.kr');
  assert.equal(context.maskEmail(''),'계정');
  assert.ok(source.includes("$('#session-full-email').textContent = email"));
  assert.ok(!source.includes(".title = model.state?.auth?.email"));
});

test('AVA wizard creates only an in-memory candidate and never persists or calls backend',()=>{
  const preview=source.slice(source.indexOf('const avaRoles'));
  const definition=source.slice(source.indexOf('const avaSteps ='),source.indexOf('const avaDraft ='));
  assert.equal(vm.runInNewContext(definition+';avaSteps.length'),9);
  assert.ok(preview.includes('AVA v1 후보 생성'));
  assert.ok(preview.includes('data-ava-action="create"'));
  assert.ok(preview.includes("candidate: null"));
  assert.doesNotMatch(preview,/fetch\(|api\(|localStorage|sessionStorage/);
  assert.ok(preview.includes("avaDraft.values = avaSteps.map(() => '')"));
  assert.ok(preview.includes("avaDraft.candidate = null"));
});

test('AVA candidate builder blocks blank settings and creates a client-only non-executable snapshot',()=>{
  const context=vm.createContext({});
  vm.runInContext(getFunction('buildAvaCandidate'),context);
  const steps=[
    ['역할'],['기억 범위'],['목표와 선호'],['권한과 도구'],
    ['실행 자원'],['예산'],['승인'],['첫 시험'],['AVA v1']
  ];
  const blank=context.buildAvaCandidate(['기획','','목표','읽기','PC','0원','승인','시험'],steps,'2026-10-06T14:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(blank)),{ok:false,error:'8개 설정을 모두 입력해 주세요.'});
  const values=[' 기획 ',' 프로젝트 A ',' 짧게 보고 ',' 읽기·초안 ',' Local AI ',' 외부 유료 호출 없음 ',' 외부 실행 전 승인 ',' 초안 QA '];
  const built=context.buildAvaCandidate(values,steps,'2026-10-06T14:00:00.000Z');
  assert.equal(built.ok,true);
  assert.equal(built.candidate.version,'AVA_V1_CANDIDATE');
  assert.equal(built.candidate.status,'CANDIDATE');
  assert.equal(built.candidate.generatedAt,'2026-10-06T14:00:00.000Z');
  assert.equal(built.candidate.clientOnly,true);
  assert.equal(built.candidate.saved,false);
  assert.equal(built.candidate.executable,false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(built.candidate.settings)),
    steps.slice(0,8).map((step,index)=>({label:step[0],value:values[index].trim()}))
  );
  values[0]='변경';
  assert.equal(built.candidate.settings[0].value,'기획');
});

test('AVA candidate UI states that it is not saved, not executable, reset clears it, and status announcements persist',()=>{
  const preview=source.slice(source.indexOf('const avaRoles'));
  assert.ok(preview.includes('이 브라우저 화면에서만'));
  assert.ok(preview.includes('저장되지 않습니다'));
  assert.ok(preview.includes('실행 권한이 없습니다'));
  assert.ok(preview.includes('CANDIDATE'));
  assert.ok(preview.includes("if (action.dataset.avaAction === 'reset')"));
  assert.ok(preview.includes("avaDraft.candidate = null"));
  assert.match(consoleHtml,/id="ava-live-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.ok(preview.includes("const liveStatus = $('#ava-live-status')"));
  assert.ok(preview.includes('liveStatus.textContent = avaDraft.message'));
});

test('resource raw identifiers are confined to closed advanced details',()=>{
  const context=vm.createContext({esc:x=>String(x),resourceName:()=> 'Test provider',badge:()=>'',resourceMode:()=>'',fmt:()=>''});
  vm.runInContext(getFunction('resourceCard'),context);
  const html=context.resourceCard({id:'SECRET_RESOURCE_ID',connectionMode:'INTERNAL_ADAPTER',executionLocation:'PC'});
  assert.ok(!html.split('<details>')[0].includes('SECRET_RESOURCE_ID'));
  assert.ok(html.includes('SECRET_RESOURCE_ID'));
  assert.ok(!html.includes('<details open'));
});

test('review copy distinguishes future World and unimplemented AVA',()=>{
  const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  for(const id of ['hi-thefa','black-box','ava','world'])assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('현재 World 참여와 AVA 간 자동 실행은 제공하지 않습니다.'));
  assert.ok(html.includes('고급 기술 보기'));
});
