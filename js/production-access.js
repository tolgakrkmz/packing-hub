/* Read the server's clock/policy; a stale preflight can never authorize a write. */
function createProductionAccessControls({scope,onState,onDefault}) {
  if(typeof HubServer==='undefined')return null;
  const message=document.getElementById('productionAccessMessage');
  let state=null,key='',sequence=0,pending=false;
  const scopeKey=()=>{const value=scope();return value.date&&value.team?value.date+'/'+value.team:'';};
  function render() {
    message.hidden=false;
    if(pending)message.textContent='Проверка на разрешената смяна…';
    else if(!state)message.textContent=key?'Не може да се провери разрешената смяна. Опреснете връзката.':'Изберете дата и екип за проверка на срока.';
    else {
      const reasons={PRODUCTION_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',PRODUCTION_TEAM_MISMATCH:'Можете да въвеждате тонаж само за екипа на акаунта си.',PRODUCTION_WINDOW_CLOSED:state.interval?'Въвеждането е извън разрешения срок. Черновата остава във формата.':'Няма разрешена смяна за този екип на избраната дата.'};
      const format=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
      message.textContent=state.allowed&&state.reported&&!state.canCreate?'Тонажът за тази смяна вече е въведен. Втори запис не е разрешен.':state.allowed?state.deadline?'Разрешено въвеждане до '+format.format(state.deadline)+' · Europe/Sofia':'Въвеждането за Стикери няма срок.':state.adminException?'Административно изключение: при запис е задължителна причина в журнала.':reasons[state.code];
    }
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
  HubServer.watch('production-log',refresh);HubServer.watch('production-access',refresh);HubServer.watch('accounts',refresh);
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  HubServer.json('/api/production-access').then(value=>{onDefault(value.currentScope);check();}).catch(()=>{check();});
  return {check,refresh,canSave:editing=>!pending&&key===scopeKey()&&!!state?.[editing?'canEdit':'canCreate']};
}
