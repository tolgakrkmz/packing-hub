/* Server clock and assignment govern planning, targets and pair results. */
function createPairAccessControls({scope,onState}) {
  if(typeof HubServer==='undefined')return null;
  const message=document.getElementById('pairAccessMessage');
  let state=null,key='',sequence=0,pending=false;
  const scopeKey=()=>{const value=scope();return value?value.date+'/'+value.team+'/'+value.shiftCode:'';};
  function render() {
    message.hidden=false;
    const reasons={PAIR_TEAM_REQUIRED:'Акаунтът няма зададен екип. Обърнете се към администратор.',PAIR_TEAM_MISMATCH:'Можете да въвеждате двойки и таргети само за екипа на акаунта си.',PAIR_WINDOW_CLOSED:state?.interval?'Въвеждането е извън разрешения срок. Черновата остава във формата.':'Няма разрешена смяна за този екип на избраната дата.'};
    const format=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
    message.textContent=pending?'Проверка на разрешената смяна…':!state?'Не може да се провери разрешената смяна. Опреснете връзката.':state.allowed?'Разрешено въвеждане до '+format.format(state.deadline)+' · Europe/Sofia':state.adminException?'Административен достъп според правата на акаунта.':reasons[state.code];
    onState(state);
  }
  async function refresh() {
    const selected=scope(),requested=scopeKey(),ticket=++sequence;
    key=requested;state=null;pending=!!requested;render();
    if(!requested)return;
    try {
      const value=await HubServer.json('/api/pair-access?'+new URLSearchParams(selected));
      if(ticket!==sequence||requested!==scopeKey())return;
      state=value;
    } catch {if(ticket!==sequence)return;}
    finally {if(ticket===sequence){pending=false;render();}}
  }
  function check(){if(key!==scopeKey())refresh();}
  for(const kind of ['accounts','production-access'])HubServer.watch(kind,refresh);
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  return {check,refresh,extraordinary:()=>key===scopeKey()&&state?.interval?.extraordinary===true,canSave:correction=>!pending&&key===scopeKey()&&!!state?.[correction?'canEdit':'canCreate']};
}
