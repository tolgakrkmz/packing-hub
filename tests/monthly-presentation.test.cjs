const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const sandbox = vm.createContext({Intl, Blob, Response, DecompressionStream, TextDecoder, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer});
for (const file of ['pptx-template', 'monthly-presentation-model']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), sandbox);
const [pptx, presentation] = vm.runInContext('[PptxTemplate, MonthlyPresentation]', sandbox);

// Fictional round figures; real monthly reports never belong in tests.
const report = (date, shift, autoKg, manKg, extra = {}) => ({date, shift, tonnage:autoKg + manKg, brak:0, breakdown:{autoKg, autoCrates:10, manKg, manCrates:5}, ...extra});
const production = [
  report('2026-09-02', 'А', 500000, 600000, {brak:20000}), report('2026-09-03', 'Б', 300000, 400000),
  {date:'2026-09-04', shift:'СТИКЕРИ', tonnage:100400, brak:0},
  report('2026-08-05', 'В', 900000, 1100000), report('2026-07-06', 'Г', 1000000, 1000000), report('2026-06-01', 'А', 5000, 5000)
];
const downtime = [{date:'2026-09-02', durationMin:180 * 60}, {date:'2026-09-20', durationMin:36 * 60}, {date:'2026-08-31', durationMin:999}];
const inputs = {profiles:'450000', dispatchedT:'1800', extrudedT:'2400', realizationT:'1900', anodizingT:'20', sawsT:'50', cncT:'30', specialT:'100',
  stations:'2', trucks:'6', trucksTarget:'8'};

test('monthly values add the packing routes and the reconciliation', () => {
  const v = presentation.values({month:'2026-09', production, downtime, inputs});
  assert.deepEqual([v.monthName, v.p1Name, v.p2Name, v.monthShort, v.p2Short, v.year], ['September', 'August', 'July', 'Sep', 'Jul', '2026']);
  assert.deepEqual([v.packedT, v.autoT, v.manualT, v.stickersT, v.cases], ['1,900', '800', '1,000', '100.4', '30']);
  assert.deepEqual([v.p1PackedT, v.p2PackedT, v.autoShare, v.p1AutoShare], ['2,000', '2,000', '42.1%', '45.0%']);
  assert.deepEqual([v['chart.auto'], v['chart.manual'], v['chart.stickers'], v['chart.p2Auto']], ['800', '1000', '100.4', '1000']);
  assert.deepEqual([v.calendarDays, v.workingDays, v.dispatchDay, v.profilesDay], ['30', '22', '81.8', '15,000']);
  // Scrap comes from the reports: 20 t + 100 t special production = 120 t outside the standard flow.
  assert.deepEqual([v.diffT, v.awaitingT, v.scrapT, v.outsideT, v.actualT, v.actualShare], ['500', '100', '20', '120', '280', '56%']);
});

test('automatic line utilization and scenarios follow downtime and stations', () => {
  const v = presentation.values({month:'2026-09', production, downtime, inputs});
  assert.deepEqual([v.calendarH, v.downtimeH, v.runningH, v.availability, v.downtimeShare], ['720', '216', '504', '70.0%', '30.0%']);
  assert.deepEqual([v.stations, v.stationLoading, v.effectiveUse], ['2', '40.0%', '28.0%']);
  assert.deepEqual([v['chart.actual'], v['chart.sameUptime'], v['chart.noDowntime'], v['chart.full']], ['800', '2000', '1142.9', '2857.1']);
  assert.deepEqual([v.trucksPerformance, v.trucksGap, v.trucksUplift], ['75%', '+2', '+33.3%']);
});

test('empty inputs and months stay visible as dashes, never as NaN', () => {
  const v = presentation.values({month:'2026-01', production:[], downtime:[], inputs:{}});
  assert.deepEqual([v.p1Name, v.p2Name, v.year], ['December', 'November', '2026']);
  assert.deepEqual([v.profiles, v.extrudedT, v.stations, v.trucksGap, v.autoShare, v['chart.full']], ['—', '—', '—', '—', '—', '0']);
  assert.ok(Object.values(v).every(value => typeof value !== 'string' || !value.includes('NaN')));
  assert.deepEqual({...v._empty}, {current:true, previous:true});
});

// Minimal deck: one deflated slide with tokens, one chart, one untouched stored image.
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text), data = deflate ? zlib.deflateRawSync(raw) : raw, nameBytes = Buffer.from(name), head = Buffer.alloc(30), dir = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(deflate ? 8 : 0, 8); head.writeUInt32LE(zlib.crc32(raw), 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(deflate ? 8 : 0, 10); dir.writeUInt32LE(zlib.crc32(raw), 16);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(head, nameBytes, data); central.push(dir, nameBytes); offset += 30 + nameBytes.length + data.length;
  }
  const size = Buffer.concat(central).length, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
async function unzip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return Object.fromEntries(pptx.readEntries(bytes).map(entry => {
    const raw = entry.method === 8 ? zlib.inflateRawSync(entry.data) : Buffer.from(entry.data);
    assert.equal(zlib.crc32(raw), entry.crc, entry.name + ' checksum');
    return [entry.name, raw.toString()];
  }));
}

test('the template is filled with escaped values and other parts are copied unchanged', async () => {
  const deck = zip([['ppt/slides/slide1.xml', '<a:t>{{monthName}} – {{packedT}} t, {{unknown}}</a:t>', true],
    ['ppt/charts/chart1.xml', '<c:v>{{chart.auto}}</c:v>', true], ['ppt/media/image1.png', 'PNG{{monthName}}', false]]);
  const {blob, missing} = await pptx.fill(deck.buffer.slice(deck.byteOffset, deck.byteOffset + deck.length), {monthName:'R&D <Sep>', packedT:'1,500', 'chart.auto':'700'});
  assert.deepEqual([...missing], ['unknown']);
  assert.deepEqual(await unzip(blob), {'ppt/slides/slide1.xml':'<a:t>R&amp;D &lt;Sep&gt; – 1,500 t, —</a:t>', 'ppt/charts/chart1.xml':'<c:v>700</c:v>', 'ppt/media/image1.png':'PNG{{monthName}}'});
});

test('files without template fields are rejected', async () => {
  const plain = zip([['ppt/slides/slide1.xml', '<a:t>September</a:t>', true]]);
  await assert.rejects(pptx.fill(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.length), {}), /NO_TOKENS/);
  await assert.rejects(pptx.fill(new ArrayBuffer(40), {}), /NOT_PPTX/);
});
