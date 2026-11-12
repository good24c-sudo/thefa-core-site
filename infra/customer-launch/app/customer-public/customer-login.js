'use strict';
(() => {
  const signingUp=location.pathname==='/signup';
  if(signingUp){document.title='회원가입 | THE FA Core';document.getElementById('login-title').textContent='나의 더파코어를 시작하세요.';}
  const group=document.getElementById('login-providers'),status=document.getElementById('login-status');
  const buttons=[...group.querySelectorAll('[data-provider]')];let busy=false,catalog=null;
  function verifiedCatalog(data){
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
  function syncEmail(enabled){
    if(!emailForm)return;emailEnabled=enabled;emailInput.disabled=!enabled||emailBusy;sendCode.disabled=!enabled||emailBusy||busy;
    codeInput.disabled=!enabled||!sentEmail||emailBusy;verifyCode.disabled=!enabled||!sentEmail||emailBusy||busy;
    codeRow.hidden=!sentEmail;
    if(!enabled)emailStatus.textContent='이메일 로그인 준비 중입니다. Google 로그인을 이용해 주세요.';

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
      event.preventDefault();if(!emailEnabled||emailBusy||busy||!sentEmail)return;
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
      const data=await request('/api/auth/providers');catalog=verifiedCatalog(data);syncEmail(data.email?.enabled===true);if(emailForm&&emailEnabled&&!sentEmail&&!emailBusy)emailStatus.textContent='인증번호로 이메일 주소를 확인합니다.';let enabled=0;
      for(const button of buttons){
        const provider=catalog[button.dataset.provider];
        button.disabled=!provider?.enabled;button.querySelector('.provider-note').textContent=provider?.enabled?'':'Google 로그인 준비 중';
        if(provider?.enabled)enabled++;
      }
      status.textContent=enabled?'원하는 계정으로 간편하게 시작하세요.':'간편 로그인을 준비하고 있습니다. 작업공간을 먼저 둘러보세요.';
      if(location.hash==='#login-failed'){status.textContent='로그인이 취소됐거나 완료되지 않았습니다. 다시 시도해 주세요.';status.classList.add('error');}
    }catch{syncEmail(false);catalog=null;buttons.forEach(button=>button.disabled=true);status.textContent='로그인 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';status.classList.add('error');}
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
  document.getElementById('continue-guest').addEventListener('click',async event=>{
    event.preventDefault();if(busy||emailBusy)return;
    try{await request('/auth/logout',{});location.assign('/');}
    catch{status.textContent='작업공간 화면으로 이동하지 못했습니다. 잠시 후 다시 시도해 주세요.';}
  });
  async function initUnifiedIdentity(){
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
      status.textContent='THE FA 통합 계정으로 로그인하세요. 단골리턴과 같은 계정입니다.';
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
            ?'THE FA 통합 계정으로 로그인했습니다.'
            :'THE FA 통합 계정 인증을 완료했습니다. Core 고객 계정 연결은 준비 중입니다.';
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
  void (async()=>{await init();await initUnifiedIdentity();})();
})();
