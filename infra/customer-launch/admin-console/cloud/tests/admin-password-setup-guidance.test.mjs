import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../login.html',import.meta.url),'utf8');
const js=await readFile(new URL('../login.js',import.meta.url),'utf8');
test('existing admin uses verified reset rather than silent existing-email signup',()=>{
  assert.match(html,/href="https:\/\/thefacore\.com\/login#email-login-form"/);
  assert.doesNotMatch(html,/href="https:\/\/thefacore\.com\/signup#email-login-form"/);
  assert.match(html,/비밀번호 처음 설정·재설정/);
  assert.match(html,/회원가입을 다시 해도 비밀번호가 설정되지 않습니다/);
  assert.match(js,/비밀번호를 처음 설정하거나 재설정하려면/);
});
test('existing OTP fallback and password form remain available',()=>{
  assert.match(html,/id="passwordForm"/);
  assert.match(html,/id="password"/);
  assert.match(html,/이메일 인증번호/);
  assert.match(js,/\/auth\/password-login/);
});
