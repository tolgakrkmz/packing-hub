/* One authenticated snapshot; failed or superseded reads never become success. */
(()=>{
  const $=id=>document.getElementById(id), message=$('closeoutMessage'),summary=$('closeoutSummary');
  let selected=new URLSearchParams(location.search), sequence=0, state=null, invalid=false;
  const errorText='Не могат да се заредят отчетите. Опитайте отново.';
  if(typeof HubServer==='undefined'){message.textContent='Екранът изисква вход в сървъра.';return;}
  try {
    if(selected.has('target')) {
      if(selected.getAll('target').length!==1)throw new Error();
      const parts=selected.get('target').split('/');if(parts.length!==3)throw new Error();
      const scope=HubReportScope.parse(new URLSearchParams({date:parts[0],team:parts[1],shiftCode:parts[2]}));
      for(const key of ['date','team','shiftCode'])if(selected.has(key)&&selected.get(key)!==String(scope[key]))throw new Error();
      selected=new URLSearchParams(scope);
    }
  } catch {invalid=true;message.textContent=errorText;}
  function link(node,path,scope,target) {
    const params=new URLSearchParams(scope);if(target)params.set('target',target);
    node.href=path+'?'+params;
  }
  function render(value) {
    state=value;
    if(value.configurationRequired){summary.hidden=true;message.textContent='Акаунтът няма зададен екип. Обърнете се към администратор.';return;}
    summary.hidden=false;summary.dataset.date=value.scope.date;summary.dataset.stale='false';
    selected=new URLSearchParams(value.scope);history.replaceState(null,'',location.pathname+'?'+selected);
    $('closeoutDate').value=value.scope.date;$('closeoutShift').value=String(value.scope.shiftCode);
    $('closeoutTeam').replaceChildren(...value.teams.map(team=>{const option=document.createElement('option');option.value=team;option.textContent=team;return option;}));
    $('closeoutTeam').value=value.scope.team;
    const format=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
    $('closeoutInterval').textContent=value.interval?format.format(value.interval.start)+' – '+format.format(value.interval.end)+' · Europe/Sofia':value.scope.date+' · Europe/Sofia';
    $('closeoutPhase').textContent={upcoming:'Предстояща смяна',working:'В ход',ended:'Приключила смяна',overdue:'Очакват се отчети след смяната',rest:'Почивка по график'}[value.phase];
    const status=$('closeoutProductionStatus');status.textContent=value.production?{missing:'Липсва',entered:'Въведен','not-applicable':'Не е приложимо'}[value.production.state]:'Нямате достъп';
    status.dataset.state=value.production?.state||'unavailable';
    const productionLink=$('closeoutProductionLink');productionLink.hidden=!value.canReportProduction||!value.interval;
    link(productionLink,'/production-log',value.scope);
    productionLink.textContent=value.productionAccess?.adminException?'Въведи с административна причина':'Въведи тонаж';
    const access=value.productionAccess;
    $('closeoutProductionWindow').textContent=!access?'':access.adminException?'Закъснелият отчет изисква административна причина.':access.allowed?'Разрешено въвеждане до '+format.format(access.deadline)+' · Europe/Sofia':access.interval?'Въвеждането е извън разрешения срок. Обърнете се към администратор.':'Няма разрешена смяна за този екип на избраната дата.';
    const pairs=value.pairs;
    for(const key of ['planned','reported','pending','cancelled'])$('closeout'+key[0].toUpperCase()+key.slice(1)).textContent=pairs?String(pairs[key]):'—';
    $('closeoutPairsNote').textContent=!pairs?'Нямате достъп':!pairs.planned?'Няма планирани двойки':pairs.pending?'Има двойки без отчет':'Всички активни двойки са отчетени';
    const list=$('closeoutPairs');list.replaceChildren();
    if(pairs)for(const entry of [...pairs.entries].sort((a,b)=>(a.state==='pending'?-1:1)-(b.state==='pending'?-1:1))) {
      const card=document.createElement('article');card.className='closeout-pair';card.dataset.closeoutPair=entry.id;card.dataset.state=entry.state;
      const heading=document.createElement('h3');heading.translate=false;heading.textContent=entry.members.map(p=>p.name).join(' + ');
      const status=document.createElement('p');status.textContent={pending:'Липсва отчет',reported:'Въведен',cancelled:'Не е приложимо — отменена двойка'}[entry.state];card.append(heading,status);
      if(entry.state==='cancelled') {
        const reason=document.createElement('p');reason.textContent={left:'Тръгнал си',cleaning:'Чистене','other-work':'Извършване на друга дейност',other:'Друга причина'}[entry.reasonKey]||'Друга причина';card.append(reason);
        if(entry.reasonText){const note=document.createElement('p');note.translate=false;note.textContent=entry.reasonText;card.append(note);}
      }
      if(entry.state==='pending'&&value.canReportPairs){const action=document.createElement('a');action.textContent='Отчети двойката';link(action,'/pair-targets',value.scope,entry.id);card.append(action);}
      list.append(card);
    }
  }
  async function refresh() {
    if(invalid)return;
    const ticket=++sequence, query=new URLSearchParams(selected);
    message.textContent='Зареждане…';if(state)summary.dataset.stale='true';
    try {
      const value=await HubServer.json('/api/shift-closeout?'+query);
      if(ticket!==sequence)return;message.textContent='';render(value);
    } catch {
      if(ticket!==sequence)return;
      if(state&&!state.configurationRequired){summary.dataset.stale='true';message.textContent='Данните не са актуални. Опреснете, за да проверите липсите.';}
      else {summary.hidden=true;message.textContent=errorText;}
    }
  }
  $('closeoutDate').addEventListener('change',()=>{selected.set('date',$('closeoutDate').value);selected.delete('shiftCode');refresh();});
  $('closeoutTeam').addEventListener('change',()=>{selected.set('team',$('closeoutTeam').value);selected.delete('shiftCode');refresh();});
  $('closeoutShift').addEventListener('change',()=>{selected.set('shiftCode',$('closeoutShift').value);if(HubServer.user.role==='admin')selected.delete('team');refresh();});
  $('closeoutCurrent').addEventListener('click',()=>{invalid=false;selected=new URLSearchParams();refresh();});
  $('closeoutRefresh').addEventListener('click',refresh);
  for(const module of ['production-log','pair-targets','accounts','production-access'])HubServer.watch(module,refresh);
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
})();
