import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {windowsPowerShellEnvironment} from '../runtime/provider-host.mjs';

test('Windows PowerShell loads its security module despite inherited PowerShell 7 module paths', {skip:process.platform!=='win32'},()=>{
 const parent={...process.env,PSModulePath:'C:\\Program Files\\PowerShell\\7\\Modules'};
 const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  "$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString 'TEST_ONLY_VALUE' -AsPlainText -Force; if($s.Length -ne 15){throw 'SECURITY_MODULE_TEST_FAILED'}; 'SECURITY_MODULE_LOADED'"],
  {encoding:'utf8',windowsHide:true,env:windowsPowerShellEnvironment(parent)});
 assert.equal(out.trim(),'SECURITY_MODULE_LOADED');
 assert.equal(parent.PSModulePath,'C:\\Program Files\\PowerShell\\7\\Modules');
});
