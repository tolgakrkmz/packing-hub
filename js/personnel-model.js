/* Shared personnel normalization for legacy imports and the personnel screen. */
const PersonnelModel = (() => {
const CATS = [
  {key:'auto', label:'Автоматична линия', short:'Автоматична', teams:['А','Б','В','Г']},
  {key:'manual', label:'Ръчна опаковка', short:'Ръчна', teams:['А','Б','В','Г']},
  {key:'stickers', label:'Стикери', short:'Стикери', teams:['1 смяна']}
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c=>[c.key,c]));
const MAIN_TEAMS = ['А','Б','В','Г'];

const DEFAULT_ROLES = ['Началник смяна','Оператор пулт 1','Оператор пулт 2','Чемберовач','Кранист/чемберовач','Обслужващ','Опаковчик'];
function uniqueRoles(values){
  const result=[], keys=new Set();
  for(const value of values){
    const role=String(value||'').trim().replace(/\s+/g,' '), key=cleanRoleKey(role);
    if(role && !keys.has(key)){ result.push(role); keys.add(key); }
  }
  return result;
}
function roles(settings={},employees=[]){
  return uniqueRoles([...DEFAULT_ROLES,...(settings.customRoles||[]),...employees.map(p=>p.role)]);
}

const DEFAULT_PERSONNEL_SETTINGS = {stickersStage1:4,stickersStage2:6};
function normalizeSettings(value,employees=[]){
  const raw=value||{};
  const customRoles=uniqueRoles([...(Array.isArray(raw.customRoles) ? raw.customRoles : []),...employees.map(p=>normalizeRole(p.category,p.role)).filter(role=>!DEFAULT_ROLES.includes(role))]);
  return {
    stickersStage1: Number.isFinite(Number(raw.stickersStage1)) ? Math.max(0,Math.round(Number(raw.stickersStage1))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage1,
    stickersStage2: Number.isFinite(Number(raw.stickersStage2)) ? Math.max(0,Math.round(Number(raw.stickersStage2))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage2,
    ...(Array.isArray(raw.customRoles) || customRoles.length ? {customRoles} : {})
  };
}
function cleanRoleKey(value){
  return String(value||'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
}
function normalizeRole(category, role, allowed=DEFAULT_ROLES){
  const key=cleanRoleKey(role);
  const exact=allowed.find(r=>cleanRoleKey(r)===key);
  if(exact) return exact;

  return String(role||'').trim().replace(/\s+/g,' ') || 'Опаковчик';
}
function normalizeEmployee(p){
  const category=CAT_BY_KEY[p.category] ? p.category : 'auto';
  const allowed=CAT_BY_KEY[category].teams;
  const team=allowed.includes(p.team) ? p.team : allowed[0];
  const name=String(p.name||'').trim();
  return {
    id:String(p.id||''),
    name,
    category,
    team,
    role:normalizeRole(category,p.role),
    active:p.active !== false,
    note:String(p.note||'').trim()
  };
}
return {DEFAULT_ROLES, roles, normalizeSettings, normalizeRole, normalizeEmployee};
})();
