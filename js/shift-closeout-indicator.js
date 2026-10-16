/* The toolbar reports only the current permitted scope, never cached success. */
((root,factory)=>{
  const value=factory();
  if(typeof module==='object'&&module.exports)module.exports=value;
  else {root.HubShiftCloseoutIndicator=value;document.addEventListener('DOMContentLoaded',()=>{if(typeof HubServer!=='undefined')value.mount(HubServer);});}
})(globalThis,()=>{
  const neutral=text=>({state:'neutral',text});
  function present(value) {
    if(!value)return neutral('Проверката е недостъпна');
    if(value.configurationRequired)return neutral('Няма зададен екип');
    if(value.phase==='rest')return neutral('Почивка по график');
    if(value.phase==='upcoming')return neutral('Предстояща смяна');
    if(!value.interval||!['working','ended','overdue'].includes(value.phase)||!value.availability)return neutral('Проверката е недостъпна');
    const production=value.availability.production,pairs=value.availability.pairs;
    if(production!==true||pairs!==true)return neutral('Няма пълен достъп');
    if(production&&!['missing','entered'].includes(value.production?.state)||pairs&&(!Number.isSafeInteger(value.pairs?.pending)||value.pairs.pending<0))return neutral('Проверката е недостъпна');
    const count=(production&&value.production.state==='missing'?1:0)+(pairs?value.pairs.pending:0);
    if(count)return {state:'missing',text:count+' '+(count===1?'липса':'липси')};
    return {state:'complete',text:'Всичко е отчетено'};
  }
  function mount(hub) {
    if(['/report-history','/report-history.html','/report-history/'].includes(location.pathname))return;
    if(!hub.canViewModule('shift-closeout'))return;
    const tools=document.querySelector('.server-tools');if(!tools)return;
    const link=document.createElement('a');link.id='serverCloseoutLink';link.className='server-closeout';link.href='/shift-closeout';
    const label=document.createElement('span');label.textContent='Край на смяната';
    const status=document.createElement('span');status.id='serverCloseoutStatus';status.className='server-closeout-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    link.append(label,status);tools.insertBefore(link,tools.querySelector('.server-links'));
    if(location.pathname==='/shift-closeout')link.setAttribute('aria-current','page');
    function paint(value){link.dataset.state=value.state;status.textContent=value.text;}
    let sequence=0;
    async function refresh() {
      if(document.hidden)return;
      const ticket=++sequence;link.href='/shift-closeout';paint(neutral('Проверка…'));
      try {
        const value=await hub.json('/api/shift-closeout');
        if(ticket!==sequence)return;
        paint(present(value));
        if(value.scope)link.href='/shift-closeout?'+new URLSearchParams(value.scope);
      } catch {if(ticket===sequence)paint(present(null));}
    }
    for(const module of ['production-log','pair-targets','accounts','production-access'])hub.watch(module,refresh);
    setInterval(refresh,30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    refresh();
  }
  return {present,mount};
});
