/* Read the server's clock/policy; a stale preflight can never authorize a write. */
function createProductionAccessControls({scope,busy,onState,onDefault}) {
  if(typeof HubServer==='undefined')return null;
  const $=id=>document.getElementById(id), message=$('productionAccessMessage'),extra=$('productionExtraShift');
  let state=null,key='',sequence=0,pending=false,configuring=false,loadedKey='';
  const authorizationDraft=HubServer.formDraft?.(extra,{isOpen:()=>extra.open&&!extra.hidden});
  const scopeKey=()=>{const value=scope();return value.date&&value.team?value.date+'/'+value.team:'';};
  function render() {
    message.hidden=false;
    if(pending)message.textContent='Проверка на разрешената смяна…';
    else if(!state)message.textContent=key?'Не може да се провери разрешената смяна. Опреснете връзката.':'Изберете дата и екип за проверка на срока.';
    else {
      const reasons={PRODUCTION_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',PRODUCTION_TEAM_MISMATCH:'Можете да въвеждате тонаж само за екипа на акаунта си.',PRODUCTION_WINDOW_CLOSED:state.interval?'Въвеждането е извън разрешения срок. Черновата остава във формата.':'Няма разрешена смяна за този екип на избраната дата.'};
      const format=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
      message.textContent=state.allowed&&state.reported&&!state.canCreate?'Тонажът за тази смяна вече е въведен. Втори запис не е разрешен.':state.allowed?'Разрешено въвеждане до '+format.format(state.deadline)+' · Europe/Sofia':state.adminException?'Административно изключение: при запис е задължителна причина в журнала.':reasons[state.code];
    }
    const selected=scope();
    const weekend=/^\d{4}-\d{2}-\d{2}$/.test(selected.date)&&[0,6].includes(new Date(selected.date+'T12:00:00Z').getUTCDay());
    extra.hidden=!(state?.canAuthorize&&selected.team==='СТИКЕРИ'&&weekend);
    if(state&&loadedKey!==key&&!authorizationDraft?.hasDraft()) {
      loadedKey=key;
      const time=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
      $('productionExtraStart').value=state.interval?.extraordinary?time(state.interval.start):'09:00';
      $('productionExtraEnd').value=state.interval?.extraordinary?time(state.interval.end):'17:30';
      authorizationDraft?.accept();
    }
    for(const id of ['productionExtraAllow','productionExtraRevoke'])$(id).disabled=pending||configuring||busy();
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
  async function configure(enabled) {
    if(configuring||busy()||pending)return;
    const reason=$('productionExtraReason').value.trim(),feedback=$('productionExtraMessage');
    if(!reason){feedback.textContent='Добави причина за разрешението.';$('productionExtraReason').focus();return;}
    const date=scope().date;
    configuring=true;render();feedback.textContent='Записва се...';
    try {
      await HubServer.send('/api/production-access','POST',{date,start:$('productionExtraStart').value,end:$('productionExtraEnd').value,enabled,reason});
      feedback.textContent=enabled?'Разрешението е записано.':'Разрешението е отменено.';
      $('productionExtraReason').value='';authorizationDraft?.accept();await refresh();
    } catch(error) {feedback.textContent=error.message;}
    finally {configuring=false;render();}
  }
  $('productionExtraAllow').addEventListener('click',()=>configure(true));
  $('productionExtraRevoke').addEventListener('click',()=>configure(false));
  HubServer.guardUpdate?.({isBusy:()=>configuring,hasDraft:()=>!!authorizationDraft?.hasDraft()||$('productionExtraReason').value.trim().length>0});
  HubServer.watch('production-log',refresh);HubServer.watch('production-access',refresh);HubServer.watch('accounts',refresh);
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  HubServer.json('/api/production-access').then(value=>{onDefault(value.currentScope);check();}).catch(()=>{check();});
  return {check,refresh,canSave:editing=>!pending&&key===scopeKey()&&!!state?.[editing?'canEdit':'canCreate']};
}
