import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('Private Alpha primary navigation is focused and secondary views are grouped', async () => {
  const html = await read('index.html');
  for (const label of [' 홈</button>', ' 작업</button>', ' 자원</button>', ' 결과</button>', ' 승인 ']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /<details class="nav-more" id="nav-more">/);
  for (const label of ['나의 AVA', '작업 근거', '기억', '로컬 설정 · 앱', '연결', '사용량']) {
    assert.match(html, new RegExp(label));
  }
});

test('Task inspection uses an explicit closeable drawer instead of auto-opening', async () => {
  const js = await read('app.js');
  assert.match(js, /detailOpen: false/);
  assert.match(js, /!task \|\| !model\.detailOpen/);
  assert.match(js, /data-action="close-detail"/);
  assert.match(js, /action === 'close-detail'/);
  assert.match(js, /model\.detailOpen = true/);
});

test('Status labels are human-readable while preserving raw mode semantics', async () => {
  const js = await read('app.js');
  for (const pair of [
    ["REAL", "실작동"],
    ["LOCAL", "로컬"],
    ["MOCK", "모의"],
    ["PLANNED", "예정"],
    ["DISCONNECTED", "미연결"],
  ]) {
    assert.match(js, new RegExp(pair[0] + ": '" + pair[1] + "'"));
  }
  assert.match(js, /title="\$\{validMode\}"/);
});

test('390px mobile layout prevents horizontal overflow patterns', async () => {
  const css = await read('styles.css');
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /\.composer-footer\{display:grid;grid-template-columns:1fr/);
  assert.match(css, /\.composer-footer \.button\{width:100%;justify-content:center\}/);
  assert.match(css, /\.suggestions\{display:grid;grid-template-columns:1fr\}/);
  assert.match(css, /\.nav-item>span:first-child,.nav-more>summary>span\{display:none\}/);
  assert.match(css, /\.detail-panel\{top:62px;left:8px;right:8px;bottom:8px\}/);
});
