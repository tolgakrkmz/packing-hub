/* Fictional data only, shared by the migration API and browser workflows. */
const entry = id => ({id, date: '2026-10-04', shift: 'А', tonnage: 2000, brak: 20, breakdown: null});
function fixture() {
  const employees = [1, 2].map(id => ({id: 'demo-legacy-person-' + id, name: 'Demo Legacy Person ' + id, category: 'stickers', team: 'old team', role: 'Опаковчик', active: false, note: ''}));
  const documents = {
    'production-log': {entries: [entry('demo-legacy-production')], goalTons: 5000},
    'line-downtime': {entries: [{id: 'demo-legacy-downtime', date: '2026-10-04', shift: 'А', start: '23:45', end: '00:15', durationMin: 30, reason: 'Fictional import downtime'}], reasons: ['Fictional import downtime']},
    personnel: {schemaVersion: 1, employees, settings: {stickersStage1: 3, stickersStage2: 5}, moveLog: [{date: '2026-10-04', type: 'update', detail: 'Fictional movement history'}]},
    'pair-targets': {module: 'pair-targets', schemaVersion: 1, entries: [{id: 'demo-legacy-pair', date: '2026-10-04', shiftCode: 1, team: 'СТИКЕРИ', members: employees.map(({id, name, category, role}) => ({id, name, category, role})), areas: ['manual'], targetKg: 2000, targetCrates: 80, result: {kg: 2000, crates: 80, reasonKey: '', reasonText: '', reportedAt: '2026-10-04T08:00:00Z'}, createdAt: '2026-10-04T06:00:00Z', updatedAt: '2026-10-04T08:00:00Z'}]},
    'package-instructions': {'900202': {number: '900202', name: 'Demo Imported Box', folderName: 'Demo Client/Demo Imported Box - 900202', client: 'Demo Client', category: 'standard', images: ['demo.svg', 'demo.pdf']}}
  };
  const contents = [Buffer.from('Fictional imported instruction.'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="green"/></svg>'), Buffer.from('Fictional demonstration PDF attachment')];
  const files = ['instruction.txt', 'demo.svg', 'demo.pdf'].map((name, index) => ({path: 'data/profiles/Demo Client/Demo Imported Box - 900202/' + name, size: contents[index].length, mime: ['text/plain', 'image/svg+xml', 'application/pdf'][index]}));
  return {payload: {documents, files, includeSettings: true}, contents};
}
module.exports = {fixture};
