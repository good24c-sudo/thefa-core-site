'use strict';
(() => {
  const signingUp=location.pathname==='/signup'||location.pathname.endsWith('/signup.html');
  const emailVerificationReturn=/(?:access_token|refresh_token|error_code)=/.test(location.hash);
  // Confirmation tokens are never stored or used as a customer session by this page.
  if(emailVerificationReturn)history.replaceState(null,'',location.pathname);
  if(signingUp){
    document.title='회원가입 | THE FA Core';
    document.getElementById('login-title').textContent='THE FA Core에 가입하세요.';
  }
  const group=document.getElementById('login-providers'),status=document.getElementById('login-status');
  const buttons=[...group.querySelectorAll('[data-provider]')];let busy=false,catalog=null;
  let managedEmail=false,recoveryReady=false;
  let recoveryCode=location.search?new URLSearchParams(location.search).get('code'):null;
  if(recoveryCode)history.replaceState(null,'',location.pathname);

  function verifiedCatalog(data){
    if(data?.email?.method==='password-confirmed'){
      if(!['https://cgrppxfdurpzzfvkmfte.supabase.co/auth/v1','https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1'].includes(data.issuer)||data.accountMode!=='fresh-launch'||!Array.isArray(data.providers)||data.providers.length!==2||data.providers.some(p=>!['google','kakao'].includes(p.id)||p.enabled!==false))throw Error('INVALID_MANAGED_CATALOG');
      return {google:{enabled:false},kakao:{enabled:false}};
    }
    if(typeof data?.issuer!=='string'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/core-customer-auth$/.test(data.issuer)||
      !Array.isArray(data.providers)||data.providers.length!==2)throw Error('INVALID_PROVIDER_CATALOG');
    const result=Object.create(null);
    for(const provider of data.providers){
      if(!['google','kakao'].includes(provider?.id)||typeof provider.enabled!=='boolean'||
        Object.hasOwn(result,provider.id)||provider.callback!==data.issuer+'/callback/'+provider.id)throw Error('INVALID_PROVIDER_CATALOG');
      if(provider.id==='kakao'&&provider.enabled)throw Error('KAKAO_DEFERRED_PROVIDER_ENABLED');
      result[provider.id]={enabled:provider.id==='google'&&provider.enabled,callback:provider.callback};
    }
    return result;
  }
  async function request(route,body){
    const response=await fetch(route,{credentials:'same-origin',cache:'no-store',
      ...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw Error(value.code||'LOGIN_FAILED');return value;
  }

  const emailForm=document.getElementById('email-login-form'),emailInput=document.getElementById('email-address'),
    codeInput=document.getElementById('email-code'),sendCode=document.getElementById('email-send-code'),
    verifyCode=document.getElementById('email-verify-code'),emailStatus=document.getElementById('email-status'),codeRow=document.getElementById('email-code-row');
  let emailEnabled=false,emailBusy=false,sentEmail=null;
  const password=document.getElementById('email-password'),confirmation=document.getElementById('email-password-confirm');
  async function managedSubmit(){
    if(!emailEnabled||emailBusy||busy||!emailForm.reportValidity())return;
    if(signingUp&&password.value!==confirmation.value){emailStatus.textContent='비밀번호 확인이 일치하지 않습니다.';confirmation.focus();return;}
    const payload={email:emailInput.value.trim().toLowerCase(),password:password.value};
    emailBusy=true;syncEmail(emailEnabled);emailStatus.textContent=signingUp?'확인 메일 발송을 요청하고 있습니다…':'이메일과 비밀번호를 확인하고 있습니다…';
    try{
      const result=await request(signingUp?'/auth/email/signup':'/auth/email/login',payload);
      if(signingUp){if(result.accepted!==true||result.verificationRequired!==true||result.authenticated!==false)throw Error('SIGNUP_RESPONSE_INVALID');password.value='';confirmation.value='';emailStatus.textContent='가입 요청을 접수했습니다. 신규 계정은 받은 메일에서 이메일을 확인한 뒤 로그인해 주세요. 이미 등록된 이메일의 비밀번호는 변경되지 않습니다. 기억나지 않으면 비밀번호 재설정을 이용해 주세요.';}
      else{if(result.authenticated!==true||result.redirect!=='/')throw Error('LOGIN_RESPONSE_INVALID');password.value='';location.assign('/');}
    }catch(error){const messages={EMAIL_CONFIRMATION_REQUIRED:'먼저 받은 가입 메일에서 이메일 확인을 완료해 주세요.',LOGIN_REJECTED:'이메일 또는 비밀번호가 일치하지 않습니다. 기존 계정은 다시 가입해도 비밀번호가 바뀌지 않습니다. 비밀번호 재설정을 이용해 주세요.',AUTH_RATE_LIMIT:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',PASSWORD_REQUIREMENTS:'비밀번호는 12자 이상으로 입력해 주세요.',SIGNUP_INPUT_REJECTED:'이메일 주소와 비밀번호 조건을 확인해 주세요.'};emailStatus.textContent=messages[error.message]||(signingUp?'가입 요청 결과를 확인하지 못했습니다. 받은 메일을 먼저 확인하고 잠시 후 다시 시도해 주세요.':'로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
    finally{emailBusy=false;syncEmail(emailEnabled);}
  }
  function syncEmail(enabled){
    if(!emailForm)return;
    emailEnabled=enabled;emailForm.hidden=!enabled||recoveryReady;
    const unavailable=document.getElementById('auth-email-availability');
    if(unavailable)unavailable.hidden=enabled;
    const recoverButton=document.getElementById('email-recover');if(recoverButton){recoverButton.hidden=!managedEmail||recoveryReady;recoverButton.disabled=!enabled||emailBusy||busy;}
    emailInput.disabled=!enabled||emailBusy;sendCode.disabled=!enabled||emailBusy||busy;
    codeInput.disabled=!enabled||!sentEmail||emailBusy;verifyCode.disabled=!enabled||!sentEmail||emailBusy||busy;
    codeRow.hidden=!sentEmail;
    const fields=document.getElementById('managed-password-fields');
    if(fields){fields.hidden=!managedEmail;password.disabled=!managedEmail||!enabled||emailBusy;password.required=managedEmail;password.minLength=managedEmail&&signingUp?12:1;
      const confirmRow=document.getElementById('managed-password-confirm-row');confirmRow.hidden=!managedEmail||!signingUp;confirmation.disabled=!managedEmail||!signingUp||!enabled||emailBusy;confirmation.required=managedEmail&&signingUp;}
    if(managedEmail){sendCode.hidden=true;codeRow.hidden=false;codeInput.hidden=true;codeInput.disabled=true;codeRow.querySelector('label').hidden=true;verifyCode.disabled=!enabled||emailBusy||busy;verifyCode.textContent=signingUp?'회원가입':'로그인';}

    if(!enabled)emailStatus.textContent='이메일 인증은 현재 연결되지 않았습니다.';

  }
  if(emailForm){
    emailInput.addEventListener('input',()=>{if(sentEmail&&emailInput.value.trim().toLowerCase()!==sentEmail){sentEmail=null;codeInput.value='';syncEmail(emailEnabled);}});
    sendCode.addEventListener('click',async event=>{
      event.preventDefault();if(!emailEnabled||emailBusy||busy||!emailInput.reportValidity())return;
      const email=emailInput.value.trim().toLowerCase();emailBusy=true;sentEmail=null;syncEmail(emailEnabled);emailStatus.textContent='인증번호 발송을 요청하고 있습니다…';
      try{const data=await request('/auth/email/send',{email});if(data.success!==true)throw Error('EMAIL_NOT_ACCEPTED');sentEmail=email;emailStatus.textContent='인증번호 발송이 접수되었습니다. 받은 메일의 6자리 번호를 5분 안에 입력해 주세요.';}
      catch(error){emailStatus.textContent=error.message==='EMAIL_RATE_LIMIT'?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':'인증번호 발송을 확인하지 못했습니다. 잠시 후 직접 다시 요청해 주세요.';}
      finally{emailBusy=false;syncEmail(emailEnabled);if(sentEmail)codeInput.focus();}
    });
    emailForm.addEventListener('submit',async event=>{
      event.preventDefault();if(managedEmail){await managedSubmit();return;}if(!emailEnabled||emailBusy||busy||!sentEmail)return;
      const email=emailInput.value.trim().toLowerCase(),otp=codeInput.value.trim();
      if(email!==sentEmail||!/^\d{6}$/.test(otp)){emailStatus.textContent='발송받은 이메일과 6자리 인증번호를 확인해 주세요.';return;}
      emailBusy=true;syncEmail(emailEnabled);emailStatus.textContent='이메일을 확인하고 있습니다…';
      try{const data=await request('/auth/email/verify',{email,otp});if(data.success!==true||data.authenticated!==true||data.redirect!=='/')throw Error('EMAIL_LOGIN_INVALID');codeInput.value='';location.assign('/');}
      catch(error){emailStatus.textContent=error.message==='EMAIL_RATE_LIMIT'?'인증 시도가 많습니다. 잠시 후 다시 시도해 주세요.':'인증번호가 만료되었거나 로그인을 완료하지 못했습니다. 인증번호를 다시 확인해 주세요.';}
      finally{emailBusy=false;syncEmail(emailEnabled);}
    });
  }

  async function init(){
    try{
      const data=await request('/api/auth/providers');managedEmail=data.email?.method==='password-confirmed';catalog=verifiedCatalog(data);syncEmail(data.email?.enabled===true);if(emailForm&&emailEnabled&&!sentEmail&&!emailBusy)emailStatus.textContent=managedEmail?(signingUp?'이메일 확인을 완료해야 로그인할 수 있습니다.':'가입한 이메일과 비밀번호로 로그인하세요.'):'인증번호로 이메일 주소를 확인합니다.';let enabled=0;
      for(const button of buttons){
        const provider=catalog[button.dataset.provider];
        button.disabled=!provider?.enabled;button.hidden=!provider?.enabled;button.querySelector('.provider-note').textContent=provider?.enabled?'':'연결 확인 필요';
        if(provider?.enabled)enabled++;
      }
      status.textContent=managedEmail?(signingUp?'이메일로 THE FA Core 계정을 만드세요.':'이메일로 THE FA Core에 로그인하세요.'):enabled?'원하는 계정으로 간편하게 시작하세요.':'간편 로그인을 준비하고 있습니다. 작업공간을 먼저 둘러보세요.';
      if(managedEmail){document.getElementById('auth-method-note').textContent=signingUp?'비밀번호는 12자 이상입니다. 확인 메일을 통해 이메일 소유권을 검증합니다.':'비밀번호는 인증 서버에서 검증하며 이 브라우저에 저장하지 않습니다.';document.querySelector('.intro').textContent=signingUp?'이메일 확인 후 가입한 계정으로 작업공간을 사용할 수 있습니다.':'가입한 이메일과 비밀번호를 입력해 주세요.';if(emailVerificationReturn)emailStatus.textContent='이메일 확인 링크를 열었습니다. 확인이 완료됐다면 비밀번호로 로그인해 주세요.';}

      if(location.hash==='#login-failed'){status.textContent='로그인이 취소됐거나 완료되지 않았습니다. 다시 시도해 주세요.';status.classList.add('error');}
    }catch{syncEmail(false);catalog=null;buttons.forEach(button=>{button.disabled=true;button.hidden=true;});status.textContent='기존 로그인 서버와 연결하지 못했습니다. 통합 계정 연결을 확인합니다.';status.classList.add('error');}
    finally{group.setAttribute('aria-busy','false');}
  }
  for(const button of buttons)button.addEventListener('click',async()=>{
    if(busy||emailBusy||button.disabled||!catalog?.[button.dataset.provider]?.enabled)return;busy=true;buttons.forEach(b=>b.disabled=true);
    group.setAttribute('aria-busy','true');status.classList.remove('error');status.textContent='로그인 페이지로 이동합니다…';
    try{
      const data=await request('/auth/start',{provider:button.dataset.provider});
      const target=new URL(data.location);
      const provider=button.dataset.provider;
      const direct=provider==='google'&&target.origin==='https://accounts.google.com'&&target.pathname==='/o/oauth2/v2/auth'&&
        target.searchParams.get('redirect_uri')===catalog[provider].callback&&
        ['redirect_uri','client_id','state'].every(k=>target.searchParams.getAll(k).length===1&&target.searchParams.get(k));
      if(target.protocol!=='https:'||target.username||target.password||target.hash||!direct)throw Error('UNEXPECTED_LOGIN_DESTINATION');
      location.assign(target.href);
    }catch{busy=false;await init();status.textContent='로그인을 시작하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';status.classList.add('error');}
  });
  document.getElementById('continue-guest').addEventListener('click',event=>{
    event.preventDefault();
    if(busy||emailBusy)return;
    // This navigation must not call logout or discard an existing identity.
    location.assign('/');
  });
  function recoveryMessage(code){
    const messages={AUTH_RATE_LIMIT:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',RECOVERY_BROWSER_REQUIRED:'재설정을 요청한 같은 브라우저에서 메일 링크를 열어 주세요. 요청한 적이 없다면 비밀번호 재설정을 먼저 눌러 주세요.',RECOVERY_CODE_INVALID:'확인 링크가 만료되었거나 이미 사용됐습니다. 비밀번호 재설정을 다시 요청해 주세요.',RECOVERY_IDENTITY_MISMATCH:'요청한 이메일과 확인된 계정이 다릅니다. 올바른 이메일로 다시 요청해 주세요.',RECOVERY_VERIFICATION_REQUIRED:'본인 확인이 만료됐습니다. 비밀번호 재설정 메일을 다시 요청해 주세요.',PASSWORD_REQUIREMENTS:'새 비밀번호는 12자 이상으로 입력해 주세요.',PASSWORD_SAME:'이전과 다른 새 비밀번호를 입력해 주세요.'};
    return messages[code]||'요청 결과를 확인하지 못했습니다. 반복 요청하지 말고 잠시 후 상태를 확인해 주세요.';
  }
  const recoverButton=document.getElementById('email-recover'),resetForm=document.getElementById('password-reset-form');
  if(recoverButton)recoverButton.addEventListener('click',async()=>{
    if(!managedEmail||!emailEnabled||emailBusy||busy||!emailInput.reportValidity())return;
    emailBusy=true;syncEmail(emailEnabled);emailStatus.textContent='비밀번호 재설정 메일을 요청하고 있습니다…';
    try{
      const r=await request('/auth/email/recover',{email:emailInput.value.trim().toLowerCase()});
      if(r.accepted!==true||r.authenticated!==false)throw Error('RECOVERY_RESPONSE_INVALID');
      emailStatus.textContent='등록된 이메일이라면 재설정 메일이 발송됩니다. 이 브라우저에서 메일 링크를 열고 새 비밀번호를 설정해 주세요. 스팸함도 확인해 주세요.';
    }catch(e){emailStatus.textContent=recoveryMessage(e.message);}
    finally{emailBusy=false;syncEmail(emailEnabled);}
  });
  if(resetForm)resetForm.addEventListener('submit',async event=>{
    event.preventDefault();if(!recoveryReady||emailBusy||!resetForm.reportValidity())return;
    const input=document.getElementById('reset-password'),confirm=document.getElementById('reset-password-confirm'),msg=document.getElementById('reset-password-status'),button=document.getElementById('reset-password-submit');
    if(input.value!==confirm.value){msg.textContent='새 비밀번호 확인이 일치하지 않습니다.';confirm.focus();return;}
    emailBusy=true;button.disabled=true;msg.textContent='새 비밀번호를 저장하고 있습니다…';
    try{
      const r=await request('/auth/email/reset',{password:input.value});
      if(r.success!==true||r.requiresLogin!==true||r.authenticated!==false)throw Error('RESET_RESPONSE_INVALID');
      input.value='';confirm.value='';password.value='';confirmation.value='';
      recoveryReady=false;resetForm.hidden=true;syncEmail(emailEnabled);
      document.getElementById('login-title').textContent='THE FA Core 로그인';document.querySelector('.intro').textContent='기존 이메일과 새 비밀번호로 로그인해 주세요.';
      status.textContent='비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.';
      emailStatus.textContent='기존 계정과 기록은 유지됩니다. 새 비밀번호로 로그인하세요.';
      emailInput.focus();
    }catch(e){msg.textContent=recoveryMessage(e.message);}
    finally{emailBusy=false;button.disabled=false;syncEmail(emailEnabled);}
  });
  async function initRecovery(){
    if(!recoveryCode)return;
    const code=recoveryCode;recoveryCode=null;
    if(!managedEmail||!resetForm){status.textContent='비밀번호 재설정 서비스를 확인하지 못했습니다.';return;}
    emailBusy=true;syncEmail(emailEnabled);status.textContent='메일 본인 확인 결과를 검증하고 있습니다…';
    try{
      const r=await request('/auth/email/recovery/verify',{code});
      if(r.verified!==true||r.authenticated!==false)throw Error('RECOVERY_RESPONSE_INVALID');
      recoveryReady=true;resetForm.hidden=false;syncEmail(emailEnabled);
      document.getElementById('recovery-target').textContent='본인 확인 완료: '+String(r.maskedEmail||'확인된 이메일');
      document.getElementById('login-title').textContent='새 비밀번호를 설정하세요.';
      document.querySelector('.intro').textContent='계정을 새로 만들지 않고 기존 계정의 비밀번호만 변경합니다.';
      status.textContent='10분 안에 새 비밀번호를 입력해 주세요.';document.getElementById('reset-password').focus();
    }catch(e){status.textContent=recoveryMessage(e.message);status.classList.add('error');}
    finally{emailBusy=false;syncEmail(emailEnabled);}
  }
  async function initUnifiedIdentity(){
    if(managedEmail)return;
    const unified=document.getElementById('thefa-id-login');
    if(!unified)return;
    const returned=new URLSearchParams(location.search).get('oidc')==='verified';
    try{
      const reply=await fetch('/api/oidc/status',{credentials:'same-origin',cache:'no-store'});
      if(!reply.ok)return;
      const capability=await reply.json();
      if(capability?.configured!==true)return;
      unified.hidden=false;
      unified.disabled=false;
      status.classList.remove('error');
      unified.querySelector('span').textContent=signingUp?'THE FA 통합 계정으로 가입 시작':'THE FA 통합 계정으로 로그인';
      status.textContent=signingUp
        ?'통합 계정으로 본인 확인을 시작합니다. 기존 계정과 새 가입은 연결 상태 확인 후 구분됩니다.'
        :'THE FA 통합 계정으로 본인 확인을 시작할 수 있습니다. 고객 서비스 연결은 별도로 확인됩니다.';
      if(emailForm&&!emailEnabled)emailStatus.textContent='이메일 가입·로그인은 THE FA 통합 계정을 이용해 주세요.';
      unified.addEventListener('click',()=>{
        if(busy||emailBusy||unified.disabled)return;
        unified.disabled=true;
        status.classList.remove('error');
        status.textContent='THE FA 통합 로그인으로 이동합니다…';
        location.assign('/api/oidc/start');
      });
      if(returned){
        const proof=await request('/api/oidc/session');
        if(proof?.authenticated===true){
          status.classList.remove('error');
          status.textContent=proof.accountLinked===true
            ?'계정 연결을 확인했습니다. 고객 작업공간으로 이동할 수 있습니다.'
            :'통합 계정 인증은 확인됐지만 고객 서비스 계정 연결은 아직 확인되지 않았습니다.';
        }else{
          status.classList.add('error');
          status.textContent='통합 계정 인증 결과를 확인하지 못했습니다. 다시 로그인해 주세요.';
        }
      }
    }catch{
      if(returned){
        status.classList.add('error');
        status.textContent='통합 로그인 상태를 확인할 수 없습니다. 연결 상태를 확인해 주세요.';
      }
    }
  }
  void (async()=>{await init();await initUnifiedIdentity();await initRecovery();})();
})();
