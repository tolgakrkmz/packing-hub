/* Read the server's clock/policy; a stale preflight can never authorize a write. */
function createProductionAccessControls({scope,busy,onState,onDefault}) {
  if(typeof HubServer==='undefined')return null;
  const $=id=>document.getElementById(id), message=$('productionAccessMessage'),extra=$('productionExtraShift'),late=$('productionLateAccess');
  let state=null,key='',sequence=0,pending=false,configuring=false,loadedKey='';
  const authorizationDraft=HubServer.formDraft?.(extra,{isOpen:()=>extra.open&&!extra.hidden});
  const lateDraft=HubServer.formDraft?.(late,{isOpen:()=>late.open&&!late.hidden});
  const format=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
  const scopeKey=()=>{const value=scope();return value.date&&value.team?value.date+'/'+value.team:'';};
  function render() {
    message.hidden=false;
    if(pending)message.textContent='Проверка на разрешената смяна…';
    else if(!state)message.textContent=key?'Не може да се провери разрешената смяна. Опреснете връзката.':'Изберете дата и екип за проверка на срока.';
    else {
      const reasons={PRODUCTION_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',PRODUCTION_TEAM_MISMATCH:'Можете да въвеждате тонаж само за екипа на акаунта си.',PRODUCTION_WINDOW_CLOSED:state.interval?'Въвеждането е извън разрешения срок. Черновата остава във формата.':'Няма разрешена смяна за този екип на избраната дата.'};
      message.textContent=state.allowed?(state.reopened?'Временно разрешено въвеждане до ':'Разрешено въвеждане до ')+format.format(state.deadline)+' · Europe/Sofia':state.adminException?'Административно изключение: при запис е задължителна причина в журнала.':reasons[state.code];
    }
    const selected=scope();
    const weekend=/^\d{4}-\d{2}-\d{2}$/.test(selected.date)&&[0,6].includes(new Date(selected.date+'T12:00:00Z').getUTCDay());
    extra.hidden=!(state?.canAuthorize&&selected.team==='СТИКЕРИ'&&weekend);
    late.hidden=!(state?.canAuthorize&&(state.canReopen||state.lateAccess?.active));
    $('productionLateScope').textContent=selected.date+' · '+(selected.team||'');
    $('productionLateUntil').textContent=state?.lateAccess?.active?'Отключено до '+format.format(state.lateAccess.expiresAt)+' · Europe/Sofia':'Няма активно временно отключване.';
    if(state&&loadedKey!==key&&!authorizationDraft?.hasDraft()) {
      loadedKey=key;
      const time=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
      $('productionExtraStart').value=state.interval?.extraordinary?time(state.interval.start):'09:00';
      $('productionExtraEnd').value=state.interval?.extraordinary?time(state.interval.end):'17:30';
      authorizationDraft?.accept();
    }
    for(const id of ['productionExtraAllow','productionExtraRevoke'])$(id).disabled=pending||configuring||busy();
    $('productionLateAllow').disabled=pending||configuring||busy()||!state?.canReopen;
    $('productionLateRevoke').disabled=pending||configuring||busy()||!state?.lateAccess?.active;
    onState();
  }
  async function refresh() {
    const selected=scope(),requested=scopeKey(),ticket=++sequence;key=requested;state=null;pending=!!requested;render();
    if(!requested)return;
    try {
      const value=await HubServer.json('/api/production-access?'+new URLSearchParams(selected));
      if(ticket!==sequence||requested!==scopeKey())return;
      state=value;
    } catch {if(ticket!==sequence)return;}
    finally {if(ticket===sequence){pending=false;render();}}
  }
  function check() {if(key!==scopeKey())refresh();}
  async function configure(enabled,lateMode=false) {
    if(configuring||busy()||pending)return;
    const reasonInput=$(lateMode?'productionLateReason':'productionExtraReason');
    const reason=reasonInput.value.trim(),feedback=$(lateMode?'productionLateMessage':'productionExtraMessage');
    if(!reason){feedback.textContent='Добави причина за разрешението.';reasonInput.focus();return;}
    const selected=scope(),date=selected.date;
    configuring=true;render();feedback.textContent='Записва се...';
    try {
      await HubServer.send('/api/production-access','POST',lateMode?{mode:'late',date,team:selected.team,enabled,reason}:{date,start:$('productionExtraStart').value,end:$('productionExtraEnd').value,enabled,reason});
      feedback.textContent=lateMode?(enabled?'Отключено за 30 минути.':'Временното отключване е отменено.'):(enabled?'Разрешението е записано.':'Разрешението е отменено.');
      reasonInput.value='';(lateMode?lateDraft:authorizationDraft)?.accept();await refresh();
    } catch(error) {feedback.textContent=error.message;}
    finally {configuring=false;render();}
  }
  $('productionExtraAllow').addEventListener('click',()=>configure(true));
  $('productionExtraRevoke').addEventListener('click',()=>configure(false));
  $('productionLateAllow').addEventListener('click',()=>configure(true,true));
  $('productionLateRevoke').addEventListener('click',()=>configure(false,true));
  HubServer.guardUpdate?.({isBusy:()=>configuring,hasDraft:()=>!!authorizationDraft?.hasDraft()||!!lateDraft?.hasDraft()||$('productionExtraReason').value.trim().length>0||$('productionLateReason').value.trim().length>0});
  HubServer.watch('production-access',refresh);HubServer.watch('accounts',refresh);
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  HubServer.json('/api/production-access').then(value=>{onDefault(value.currentScope);check();}).catch(()=>{check();});
  return {check,refresh,canSave:editing=>!pending&&key===scopeKey()&&!!state?.[editing?'canEdit':'canCreate']};
}
