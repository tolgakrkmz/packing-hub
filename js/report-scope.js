/* Explicit deep links never inherit the device's current reporting date. */
((root,factory)=>{const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.HubReportScope=value;})(globalThis,()=>{
  function parse(search) {
    const params=new URLSearchParams(search), keys=['date','team','shiftCode'];
    if(!keys.some(k=>params.has(k)))return null;
    const date=params.get('date'),team=params.get('team'),code=params.get('shiftCode');
    if(keys.some(k=>params.getAll(k).length!==1)||params.getAll('target').length>1||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!['А','Б','В','Г','СТИКЕРИ'].includes(team)||! /^[123]$/.test(code||'')||team==='СТИКЕРИ'&&code!=='1')throw new Error('Невалидна връзка към смяна. Отворете модула от началната страница.');
    const at=new Date(date+'T12:00:00Z');
    if(!Number.isFinite(at.getTime())||at.toISOString().slice(0,10)!==date)throw new Error('Невалидна връзка към смяна. Отворете модула от началната страница.');
    return {date,team,shiftCode:Number(code)};
  }
  return {parse};
});
