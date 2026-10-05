/* Shared personnel normalization for legacy imports and the personnel screen. */
const PersonnelModel = (() => {
const CATS = [
  {key:'auto', label:'Автоматична линия', short:'Автоматична', teams:['А','Б','В','Г']},
  {key:'manual', label:'Ръчна опаковка', short:'Ръчна', teams:['А','Б','В','Г']},
  {key:'stickers', label:'Стикери', short:'Стикери', teams:['1 смяна']}
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c=>[c.key,c]));
const MAIN_TEAMS = ['А','Б','В','Г'];

const ROLE_OPTIONS = {
  auto:['Началник смяна','Оператор пулт 1','Оператор пулт 2','Чемберовач','Обслужващ','Опаковчик'],
  manual:['Началник смяна','Кранист/чемберовач','Обслужващ','Опаковчик'],
  stickers:['Началник смяна','Опаковчик']
};

const DEFAULT_PERSONNEL_SETTINGS = {stickersStage1:4,stickersStage2:6};
function normalizeSettings(value){
  const raw=value||{};
  return {
    stickersStage1: Number.isFinite(Number(raw.stickersStage1)) ? Math.max(0,Math.round(Number(raw.stickersStage1))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage1,
    stickersStage2: Number.isFinite(Number(raw.stickersStage2)) ? Math.max(0,Math.round(Number(raw.stickersStage2))) : DEFAULT_PERSONNEL_SETTINGS.stickersStage2
  };
}
function cleanRoleKey(value){
  return String(value||'').trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
}
function normalizeRole(category, role, name=''){
  const allowed=ROLE_OPTIONS[category] || ROLE_OPTIONS.auto;
  const key=cleanRoleKey(role);
  const exact=allowed.find(r=>cleanRoleKey(r)===key);
  if(exact) return exact;

  if(category==='stickers'){
    // Normalize legacy stickers roles to the supported role options.
    return 'Опаковчик';
  }
  if(category==='manual'){
    if(/началник|отговорник/.test(key)) return 'Началник смяна';
    if(/кранист|чембер/.test(key)) return 'Кранист/чемберовач';
    if(/обслужващ/.test(key)) return 'Обслужващ';
    return 'Опаковчик';
  }

  if(/началник|н-к смяна|н к смяна/.test(key)) return 'Началник смяна';
  if(/отговорник\s*1/.test(key) || /оператор\s+пулт\s*1\b/.test(key)) return 'Оператор пулт 1';
  if(/отговорник\s*2/.test(key) || /оператор\s+пулт\s*2\b/.test(key)) return 'Оператор пулт 2';
  if(/чембер/.test(key)) return 'Чемберовач';
  if(/обслужващ/.test(key)) return 'Обслужващ';
  return 'Опаковчик';
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
    role:normalizeRole(category,p.role,name),
    active:p.active !== false,
    note:String(p.note||'').trim()
  };
}
return {normalizeSettings, normalizeRole, normalizeEmployee};
})();
