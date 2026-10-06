import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const localServer = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const prepareCloud = fs.readFileSync(new URL('../../tools/Prepare-Cloud.ps1', import.meta.url), 'utf8');
const primaryLogo = new URL('../public/assets/THEFA_Core_Primary_Dark_web.svg', import.meta.url);

test('Console uses the official THEFA Core Primary logo through local and deployment paths', () => {
  assert.equal(fs.existsSync(primaryLogo), true, 'official Primary logo asset must exist');
  assert.match(index, /\/assets\/THEFA_Core_Primary_Dark_web\.svg/);
  assert.match(index, /width="180" height="50"/);
  assert.doesNotMatch(index, /THEFA_Core_Wordmark_Dark_web\.svg/);
  assert.match(localServer, /\/assets\/THEFA_Core_Primary_Dark_web\.svg/);
  assert.match(prepareCloud, /lab\/public\/assets\/THEFA_Core_Primary_Dark_web\.svg/);
});
