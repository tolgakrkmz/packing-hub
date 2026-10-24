/* Monthly presentation slides in the Package Hub colours. Fixed-size boxes so longer figures never move the layout. */
const MonthlyPresentationDeck = (() => {
  const C = {bg:'15171B', panel:'1D2025', panel2:'22262C', border:'2C3039', text:'EDEBE3', muted:'8A8D93',
    amber:'F5A623', amberDark:'3A2C10', blue:'4F95C9', teal:'3FBFA0', coral:'E0765A', purple:'A083D6', pink:'C26B9E'};
  const FONT = 'Arial', W = 13.333, M = 0.6, PAGES = 9, GAP = 0.25, RIGHT = W - M;
  const text = (slide, value, x, y, w, h, options = {}) => slide.addText(value, {x, y, w, h, fontFace:FONT, fontSize:12, color:C.text, margin:0, valign:'top', ...options});
  const box = (slide, x, y, w, h, fill = C.panel, line = C.border) => slide.addShape('roundRect', {x, y, w, h, rectRadius:0.08, fill:{color:fill}, line:{color:line, width:0.75}});
  const bar = (slide, x, y, w, h, color) => slide.addShape('rect', {x, y, w:Math.max(w, 0.01), h, fill:{color}, line:{color, width:0}});
  const label = (slide, value, x, y, w, color = C.muted) => text(slide, value.toUpperCase(), x, y, w, 0.3, {fontSize:10, bold:true, color, charSpacing:1});
  const columns = (count, x = M, width = RIGHT - M) => { const w = (width - GAP * (count - 1)) / count; return Array.from({length:count}, (_, i) => ({x:x + i * (w + GAP), w})); };
  const chartText = {catAxisLabelColor:C.muted, valAxisLabelColor:C.muted, catAxisLabelFontFace:FONT, valAxisLabelFontFace:FONT, catAxisLabelFontSize:10, valAxisLabelFontSize:9,
    valGridLine:{color:C.border, size:0.75}, catAxisLineShow:false, valAxisLineShow:false, plotArea:{fill:{color:C.panel}}, chartArea:{fill:{color:C.panel}}};

  // Shared header, colour strip and footer; returns the slide for the content.
  function frame(pptx, v, page, title, subtitle) {
    const slide = pptx.addSlide();
    slide.background = {color:C.bg};
    [C.amber, C.teal, C.blue, C.purple].forEach((color, i) => bar(slide, i * W / 4, 0, W / 4, 0.07, color));
    label(slide, `Packaging & Logistics Sector · ${v.monthName} ${v.year}`, M, 0.42, RIGHT - M, C.amber);
    text(slide, title, M, 0.72, RIGHT - M, 0.6, {fontSize:26, bold:true});
    text(slide, subtitle, M, 1.3, RIGHT - M, 0.4, {fontSize:13, color:C.muted});
    slide.addShape('line', {x:M, y:7.0, w:RIGHT - M, h:0, line:{color:C.border, width:0.75}});
    text(slide, 'Package Hub · Monthly report', M, 7.1, 6, 0.25, {fontSize:9, color:C.muted});
    text(slide, `${page} / ${PAGES}`, RIGHT - 2, 7.1, 2, 0.25, {fontSize:9, color:C.muted, align:'right'});
    return slide;
  }

  function card(slide, {x, y, w, h, title, value, unit = '', sub = '', color = C.amber, fill = C.panel, line = C.border, size = 30}) {
    box(slide, x, y, w, h, fill, line);
    bar(slide, x + 0.25, y + 0.25, 0.35, 0.05, color);
    label(slide, title, x + 0.25, y + 0.4, w - 0.5);
    text(slide, [{text:value, options:{fontSize:size, bold:true, color}}, ...(unit ? [{text:' ' + unit, options:{fontSize:13, color:C.muted}}] : [])],
      x + 0.25, y + 0.7, w - 0.5, 0.58, {valign:'middle'});
    if (sub) text(slide, sub, x + 0.25, y + h - 0.42, w - 0.5, 0.28, {fontSize:10, color:C.muted});
  }

  function list(slide, {x, y, w, h, title, total, color, items}) {
    box(slide, x, y, w, h);
    bar(slide, x + 0.25, y + 0.25, 0.35, 0.05, color);
    label(slide, title, x + 0.25, y + 0.4, w - 0.5);
    text(slide, [{text:total, options:{fontSize:26, bold:true, color}}, {text:' t', options:{fontSize:13, color:C.muted}}], x + 0.25, y + 0.68, w - 0.5, 0.5, {valign:'middle'});
    items.forEach(([name, value], i) => {
      const top = y + 1.3 + i * 0.3;
      slide.addShape('line', {x:x + 0.25, y:top - 0.03, w:w - 0.5, h:0, line:{color:C.border, width:0.5}});
      text(slide, name, x + 0.25, top, w - 1.6, 0.27, {fontSize:11, color:C.muted, valign:'middle'});
      text(slide, value + ' t', x + w - 1.35, top, 1.1, 0.27, {fontSize:11, bold:true, align:'right', valign:'middle'});
    });
  }

  function numbered(slide, {x, y, w, index, title, body, color = C.amber}) {
    slide.addShape('ellipse', {x, y, w:0.42, h:0.42, fill:{color:C.amberDark}, line:{color, width:0.75}});
    text(slide, String(index).padStart(2, '0'), x, y, 0.42, 0.42, {fontSize:11, bold:true, color, align:'center', valign:'middle'});
    text(slide, title, x + 0.6, y - 0.02, w - 0.6, 0.32, {fontSize:14, bold:true});
    text(slide, body, x + 0.6, y + 0.32, w - 0.6, 0.7, {fontSize:11, color:C.muted});
  }

  function cover(pptx, v) {
    const slide = pptx.addSlide();
    slide.background = {color:C.bg};
    [C.amber, C.teal, C.blue, C.purple].forEach((color, i) => bar(slide, i * W / 4, 0, W / 4, 0.07, color));
    // A dashboard-like motif built from shapes: no photos or company material in the code.
    box(slide, 8.35, 1.0, 4.38, 5.5);
    [[C.amber, 3.6], [C.teal, 2.7], [C.blue, 3.1], [C.purple, 1.9], [C.pink, 2.3]].forEach(([color, w], i) => {
      bar(slide, 8.75, 1.55 + i * 0.95, 3.6, 0.42, C.panel2);
      bar(slide, 8.75, 1.55 + i * 0.95, w, 0.42, color);
    });
    label(slide, 'Monthly report', M, 1.9, 7, C.amber);
    text(slide, 'Packaging and Logistics Sector', M, 2.3, 7.3, 1.75, {fontSize:44, bold:true, valign:'bottom'});
    text(slide, `${v.monthName} ${v.year}`, M, 4.2, 7.3, 0.55, {fontSize:26, bold:true, color:C.amber});
    text(slide, v.coverDate ? `Prepared ${v.coverDate}` : '', M, 4.85, 7.3, 0.35, {fontSize:13, color:C.muted});
    [['Packing', C.amber], ['Automatic line', C.teal], ['Stickers', C.pink], ['Downtime', C.coral], ['Logistics', C.blue]].forEach(([name, color], i) => {
      slide.addShape('ellipse', {x:M + i * 1.5, y:6.3, w:0.14, h:0.14, fill:{color}, line:{color, width:0}});
      text(slide, name, M + 0.24 + i * 1.5, 6.22, 1.25, 0.3, {fontSize:10, color:C.muted, valign:'middle'});
    });
    text(slide, 'Package Hub', M, 7.1, 6, 0.25, {fontSize:9, color:C.muted});
  }

  function overview(pptx, v) {
    const slide = frame(pptx, v, 2, 'Monthly Packing & Dispatch Overview', `Output and daily averages for ${v.monthName} ${v.year}`);
    const cols = columns(4), colors = [C.amber, C.teal, C.blue, C.purple];
    label(slide, 'Monthly output', M, 1.92, 6);
    [['Total packed tonnage', v.packedT, 't'], ['Packed cases', v.cases, 'pcs'], ['Packed profiles', v.profiles, 'pcs'], ['Total dispatched', v.dispatchedT, 't']]
      .forEach(([title, value, unit], i) => card(slide, {...cols[i], y:2.25, h:1.75, title, value, unit, color:colors[i]}));
    label(slide, 'Daily average performance', M, 4.25, 6);
    [['Packed tonnage / day', v.packedTDay, 't/day'], ['Packed cases / day', v.casesDay, 'pcs/day'], ['Packed profiles / day', v.profilesDay, 'pcs/day'], ['Dispatch / working day', v.dispatchDay, 't/day']]
      .forEach(([title, value, unit], i) => card(slide, {...cols[i], y:4.58, h:1.75, title, value, unit, color:colors[i], size:26}));
    text(slide, `Daily averages: packing totals ÷ ${v.calendarDays} calendar days  |  dispatch ÷ ${v.workingDays} Mon–Fri working days`, M, 6.5, RIGHT - M, 0.3, {fontSize:10, color:C.muted});
  }

  // Goal, change against the previous month, team results and tasks on one slide.
  function performance(pptx, v) {
    const slide = frame(pptx, v, 3, 'Month Performance', `Goal, change against ${v.p1Name} and team results · ${v.monthName} ${v.year}`);
    const leftW = 3.9, x = M + leftW + GAP, w = RIGHT - x, g = v.goal;
    box(slide, M, 1.95, leftW, 2.55);
    label(slide, 'Monthly goal', M + 0.25, 2.12, leftW - 0.5);
    text(slide, g.percent, M + 0.25, 2.45, leftW - 0.5, 0.7, {fontSize:36, bold:true, color:g.met ? C.teal : C.amber, valign:'middle'});
    bar(slide, M + 0.25, 3.25, leftW - 0.5, 0.18, C.panel2);
    bar(slide, M + 0.25, 3.25, (leftW - 0.5) * g.ratio, 0.18, g.met ? C.teal : C.amber);
    text(slide, `${v.packedT} t of ${g.goalT} t goal`, M + 0.25, 3.55, leftW - 0.5, 0.3, {fontSize:12});
    text(slide, g.gap, M + 0.25, 3.88, leftW - 0.5, 0.3, {fontSize:11, color:C.muted});
    box(slide, x, 1.95, w, 2.55);
    label(slide, `Change against ${v.p1Name}`, x + 0.25, 2.12, w - 0.5);
    const cell = (value, options = {}) => ({text:String(value), options:{fontFace:FONT, fontSize:10.5, color:C.text, valign:'middle', ...options}});
    const head = (value, align = 'right') => cell(value, {bold:true, color:C.muted, fontSize:9.5, align});
    const tableOptions = (top, colW) => ({x:x + 0.25, y:top, w:w - 0.5, colW, rowH:0.27, border:{type:'solid', color:C.border, pt:0.5}, fill:{color:C.panel}, margin:0.02});
    slide.addTable([[head('Metric', 'left'), head(v.monthName), head(v.p1Name), head('Change')],
      ...v.comparison.map(row => [cell(row.label), cell(row.current, {align:'right', bold:true}), cell(row.previous, {align:'right', color:C.muted}),
        cell(`${row.trend === 'up' ? '▲ ' : row.trend === 'down' ? '▼ ' : ''}${row.change}`, {align:'right', bold:true, color:row.good === null ? C.muted : row.good ? C.teal : C.coral})])],
      tableOptions(2.4, [2.4, 1.8, 1.8, 1.48]));
    box(slide, M, 4.68, w, 2.14);
    label(slide, 'Teams A–D and Stickers', M + 0.25, 4.83, w - 0.5);
    slide.addTable([[head('Team', 'left'), head('Packed'), head('Pairs reported'), head('Pair targets met'), head('Kg vs target')],
      ...v.teams.map(row => [cell(row.team, {bold:true}), cell(row.packedT + ' t', {align:'right'}), cell(row.pairs, {align:'right'}),
        cell(row.met, {align:'right', bold:true, color:C.amber}), cell(row.kg, {align:'right'})])],
      {...tableOptions(5.12, [1.5, 1.5, 1.5, 1.6, 1.38]), x:M + 0.25, w:w - 0.5, rowH:0.26});
    const tx = M + w + GAP, tw = RIGHT - tx, t = v.tasks;
    box(slide, tx, 4.68, tw, 2.14);
    label(slide, 'Tasks due this month', tx + 0.25, 4.83, tw - 0.5);
    if (!t) return text(slide, 'Tasks were not available.', tx + 0.25, 5.2, tw - 0.5, 0.4, {fontSize:12, color:C.muted});
    text(slide, [{text:t.onTime, options:{fontSize:30, bold:true, color:C.teal}}, {text:' on time', options:{fontSize:12, color:C.muted}}], tx + 0.25, 5.1, tw - 0.5, 0.55, {valign:'middle'});
    [['Completed', `${t.completed} (${t.late} late)`], ['Not done', t.notDone], ['Still open', t.open], ['Total', t.total]].forEach(([name, value], i) => {
      text(slide, name, tx + 0.25, 5.72 + i * 0.26, tw - 1.6, 0.25, {fontSize:11, color:C.muted, valign:'middle'});
      text(slide, String(value), tx + tw - 1.6, 5.72 + i * 0.26, 1.35, 0.25, {fontSize:11, bold:true, align:'right', valign:'middle'});
    });
  }

  function reconciliation(pptx, v, specialLabel) {
    const slide = frame(pptx, v, 4, 'Production-to-Packing Reconciliation', 'From extrusion output to the actual Packing-area balance');
    const cols = columns(3);
    card(slide, {...cols[0], y:1.95, h:1.75, title:'Extruded output', value:v.extrudedT, unit:'t', color:C.blue, sub:'Extrusion'});
    card(slide, {...cols[1], y:1.95, h:1.75, title:'Packing for realization', value:v.realizationT, unit:'t', color:C.teal, sub:'Packing'});
    card(slide, {...cols[2], y:1.95, h:1.75, title:'Total difference', value:v.diffT, unit:'t', color:C.amber, sub:`${v.extrudedT} t − ${v.realizationT} t`});
    list(slide, {...cols[0], y:3.92, h:2.2, title:'Awaiting further processing', total:v.awaitingT, color:C.purple,
      items:[['Anodizing & paint', v.anodizingT], ['Saws', v.sawsT], ['CNC', v.cncT]]});
    list(slide, {...cols[1], y:3.92, h:2.2, title:'Outside standard packing flow', total:v.outsideT, color:C.coral,
      items:[['Packing scrap', v.scrapT], [specialLabel, v.specialT]]});
    const {x, w} = cols[2];
    box(slide, x, 3.92, w, 2.2, C.amberDark, C.amber);
    label(slide, 'Actual for packing', x + 0.25, 4.12, w - 0.5, C.amber);
    text(slide, [{text:v.actualT, options:{fontSize:40, bold:true, color:C.amber}}, {text:' t', options:{fontSize:16, color:C.amber}}], x + 0.25, 4.4, w - 0.5, 0.7, {valign:'middle'});
    text(slide, 'Material physically available and waiting for Packing', x + 0.25, 5.12, w - 0.5, 0.45, {fontSize:11});
    text(slide, `${v.actualShare} of the total difference · ${v.diffT} − ${v.awaitingT} − ${v.outsideT} = ${v.actualT} t`, x + 0.25, 5.62, w - 0.5, 0.4, {fontSize:10, color:C.muted});
    box(slide, M, 6.27, RIGHT - M, 0.55, C.panel2);
    bar(slide, M, 6.27, 0.07, 0.55, C.amber);
    text(slide, [{text:'KEY MESSAGE   ', options:{bold:true, color:C.amber}}, {text:`The ${v.diffT} t difference does not equal Packing backlog — only ${v.actualT} t is physically available on Packing areas.`}],
      M + 0.3, 6.27, RIGHT - M - 0.5, 0.55, {fontSize:11, valign:'middle'});
  }

  function workload(pptx, v) {
    const slide = frame(pptx, v, 5, 'Packing Workload', 'Three-month view of how total packing volume is distributed by route');
    const cols = columns(4);
    [['Total packed', v.packedT, C.amber], ['Automatic line', v.autoT, C.teal], ['Manual packing', v.manualT, C.blue], ['Stickers', v.stickersT, C.pink]]
      .forEach(([title, value, color], i) => card(slide, {...cols[i], y:1.92, h:1.45, title, value, unit:'t', color, size:26}));
    const chartW = 8.2;
    box(slide, M, 3.6, chartW, 3.2);
    label(slide, `Packing mix – ${v.mix[0].name} to ${v.monthName}`, M + 0.25, 3.78, chartW - 0.5);
    const labels = v.mix.map(row => row.name);
    slide.addChart(pptx.ChartType.bar, [['Automatic line', 'auto'], ['Manual packing', 'manual'], ['Stickers', 'stickers']].map(([name, key]) => ({name, labels, values:v.mix.map(row => row[key])})),
      {x:M + 0.15, y:4.1, w:chartW - 0.3, h:2.6, barDir:'col', barGrouping:'stacked', barGapWidthPct:60, chartColors:[C.teal, C.blue, C.pink], ...chartText,
        showLegend:true, legendPos:'b', legendColor:C.muted, legendFontFace:FONT, legendFontSize:10, showValue:true, dataLabelColor:'FFFFFF', dataLabelFontSize:9, dataLabelFormatCode:'#,##0'});
    const x = M + chartW + GAP, w = RIGHT - x;
    box(slide, x, 3.6, w, 3.2);
    label(slide, 'Monthly totals', x + 0.25, 3.78, w - 0.5);
    v.mix.forEach((row, i) => {
      const top = 4.2 + i * 0.85, current = i === v.mix.length - 1;
      text(slide, row.name.toUpperCase(), x + 0.25, top, w - 0.5, 0.25, {fontSize:10, bold:true, color:current ? C.amber : C.muted, charSpacing:1});
      text(slide, [{text:row.totalT, options:{fontSize:20, bold:true, color:current ? C.amber : C.text}}, {text:' t', options:{fontSize:11, color:C.muted}}], x + 0.25, top + 0.25, 1.9, 0.45, {valign:'middle'});
      text(slide, `AL share ${row.autoShare}`, x + 2.05, top + 0.25, w - 2.3, 0.45, {fontSize:10, color:C.teal, align:'right', valign:'middle'});
    });
  }

  function automaticLine(pptx, v) {
    const slide = frame(pptx, v, 6, 'Automatic Line Capacity Utilization', `${v.monthName} actual output: ${v.autoT} t · machine availability and station loading limit effective capacity`);
    const y = 1.95, h = 1.75, w = 2.7;
    card(slide, {x:0.6, y, w, h, title:'Machine availability', value:v.availability, color:C.teal, sub:`${v.runningH} h running / ${v.calendarH} h calendar`, size:28});
    text(slide, '×', 3.35, y, 0.4, h, {fontSize:24, bold:true, color:C.muted, align:'center', valign:'middle'});
    card(slide, {x:3.8, y, w, h, title:'Station loading', value:v.stationLoading, color:C.blue, sub:`${v.stations} of 5 stations active`, size:28});
    text(slide, '=', 6.55, y, 0.4, h, {fontSize:24, bold:true, color:C.muted, align:'center', valign:'middle'});
    card(slide, {x:7.0, y, w, h, title:'Effective utilization', value:v.effectiveUse, color:C.amber, sub:'Availability × station loading', fill:C.amberDark, line:C.amber, size:28});
    card(slide, {x:RIGHT - w, y, w, h, title:'Downtime', value:v.downtimeH, unit:'h', color:C.coral, sub:`${v.downtimeShare} of calendar time`, size:28});
    const chartW = 7.4;
    box(slide, M, 3.9, chartW, 2.93);
    label(slide, 'Linearized output scenarios, tonnes', M + 0.25, 4.07, chartW - 0.5);
    slide.addChart(pptx.ChartType.bar, [{name:'Estimated output (t)', labels:v.scenarios.map(row => row.label), values:v.scenarios.map(row => row.value)}],
      {x:M + 0.15, y:4.35, w:chartW - 0.3, h:2.1, barDir:'col', barGapWidthPct:70, chartColors:[C.amber], ...chartText, catAxisLabelFontSize:9,
        showLegend:false, showValue:true, dataLabelColor:C.text, dataLabelFontSize:10, dataLabelFormatCode:'#,##0', dataLabelPosition:'outEnd'});
    text(slide, 'Assumption: output scales linearly with operating hours and active stations. A theoretical scenario, not OEE.', M + 0.25, 6.48, chartW - 0.5, 0.3, {fontSize:9, color:C.muted});
    const x = M + chartW + GAP, cw = RIGHT - x;
    box(slide, x, 3.9, cw, 2.93);
    label(slide, 'Main constraints behind lower output', x + 0.25, 4.07, cw - 0.5);
    const items = [{title:`${v.downtimeH} h downtime`, body:`The line was not operating for ${v.downtimeShare} of ${v.monthName} calendar time.`},
      ...v.reasons.map(row => ({title:row.reason, body:`${row.hours} h of downtime in ${row.stops} ${row.stops === 1 ? 'stop' : 'stops'}.`}))];
    while (items.length < 3) items.push({title:'Add a constraint', body:'Describe the cause and its effect on the line.'});
    items.forEach((item, i) => numbered(slide, {x:x + 0.25, y:4.5 + i * 0.77, w:cw - 0.5, index:i + 1, ...item, color:i ? C.amber : C.coral}));
  }

  function logistics(pptx, v, improvements) {
    const slide = frame(pptx, v, 7, 'Logistics – Operational Improvements', 'Key actions completed during the month and the next throughput target');
    const leftW = 6.6, x = M + leftW + GAP, w = RIGHT - x;
    box(slide, M, 1.95, leftW, 4.85);
    label(slide, `${v.monthName} improvements`, M + 0.25, 2.15, leftW - 0.5);
    const items = improvements.slice(0, 3);
    while (items.length < 3) items.push({title:'Add an improvement', body:'Describe the action and its outcome.'});
    items.forEach((item, i) => numbered(slide, {x:M + 0.25, y:2.65 + i * 1.35, w:leftW - 0.5, index:i + 1, ...item}));
    box(slide, x, 1.95, w, 4.85);
    label(slide, 'Loading performance', x + 0.25, 2.15, w - 0.5);
    const half = (w - 0.75) / 2;
    [['Current avg.', v.trucks, C.amber], ['Target', v.trucksTarget, C.teal]].forEach(([title, value, color], i) => {
      text(slide, title.toUpperCase(), x + 0.25 + i * (half + 0.25), 2.6, half, 0.25, {fontSize:10, bold:true, color:C.muted, charSpacing:1});
      text(slide, [{text:value, options:{fontSize:36, bold:true, color}}, {text:' trucks/day', options:{fontSize:12, color:C.muted}}], x + 0.25 + i * (half + 0.25), 2.9, half, 0.7, {valign:'middle'});
    });
    text(slide, `Current performance vs. target: ${v.trucksPerformance}`, x + 0.25, 3.85, w - 0.5, 0.3, {fontSize:11, color:C.muted});
    bar(slide, x + 0.25, 4.2, w - 0.5, 0.22, C.panel2);
    bar(slide, x + 0.25, 4.2, (w - 0.5) * v.trucksRatio, 0.22, C.amber);
    [['Gap', `${v.trucksGap} trucks/day`], ['Required uplift', v.trucksUplift]].forEach(([title, value], i) => {
      text(slide, title.toUpperCase(), x + 0.25 + i * (half + 0.25), 4.65, half, 0.25, {fontSize:10, bold:true, color:C.muted, charSpacing:1});
      text(slide, value, x + 0.25 + i * (half + 0.25), 4.92, half, 0.45, {fontSize:20, bold:true, valign:'middle'});
    });
    box(slide, x + 0.25, 5.6, w - 0.5, 1.0, C.panel2);
    bar(slide, x + 0.25, 5.6, 0.07, 1.0, C.teal);
    text(slide, [{text:'NEXT FOCUS', options:{fontSize:10, bold:true, color:C.teal, charSpacing:1, breakLine:true}},
      {text:`Increase loading throughput from ${v.trucks} to ${v.trucksTarget} trucks/day while keeping inventory accuracy and package traceability.`, options:{fontSize:11}}],
      x + 0.5, 5.7, w - 0.9, 0.85);
  }

  const unavailable = (slide, message) => { box(slide, M, 1.95, RIGHT - M, 4.85); text(slide, message, M, 1.95, RIGHT - M, 4.85, {fontSize:14, color:C.muted, align:'center', valign:'middle'}); };
  const LEVELS = {high:['High', C.coral], medium:['Medium', C.amber], low:['Low', C.teal]};

  function globalProblems(pptx, v) {
    const slide = frame(pptx, v, 8, 'Global Problems', `Status at the end of ${v.monthName} ${v.year} · for information`), p = v.problems;
    if (!p) return unavailable(slide, 'Global problems were not available when the presentation was created.');
    const cols = columns(4);
    card(slide, {...cols[0], y:1.95, h:1.75, title:'Active problems', value:String(p.active), color:C.amber, sub:`${p.open} open · ${p.proposed} with a proposed solution`});
    card(slide, {...cols[1], y:1.95, h:1.75, title:'New this month', value:String(p.created), color:C.blue, sub:'Recorded during the month'});
    card(slide, {...cols[2], y:1.95, h:1.75, title:'Resolved this month', value:String(p.resolved), color:C.teal, sub:'Closed during the month'});
    card(slide, {...cols[3], y:1.95, h:1.75, title:'High impact', value:String(p.byImpact[0].count), color:C.coral, sub:'Active at month end'});
    const leftW = 4.2, x = M + leftW + GAP, w = RIGHT - x, most = Math.max(1, ...p.byImpact.map(row => row.count));
    box(slide, M, 3.9, leftW, 2.9);
    label(slide, 'Active by impact', M + 0.25, 4.07, leftW - 0.5);
    p.byImpact.forEach((row, i) => {
      const [name, color] = LEVELS[row.level], top = 4.55 + i * 0.7, track = leftW - 2.0;
      text(slide, name, M + 0.25, top, 0.95, 0.35, {fontSize:12, color:C.muted, valign:'middle'});
      bar(slide, M + 1.25, top + 0.08, track, 0.2, C.panel2);
      bar(slide, M + 1.25, top + 0.08, track * row.count / most, 0.2, color);
      text(slide, String(row.count), M + leftW - 0.65, top, 0.4, 0.35, {fontSize:14, bold:true, align:'right', valign:'middle'});
    });
    box(slide, x, 3.9, w, 2.9);
    label(slide, 'Longest open, by impact', x + 0.25, 4.07, w - 0.5);
    if (!p.oldest.length) text(slide, 'No active problems at month end.', x + 0.25, 4.5, w - 0.5, 0.4, {fontSize:12, color:C.muted});
    p.oldest.forEach((row, i) => {
      const top = 4.45 + i * 0.45, [, color] = LEVELS[row.level] || ['', C.muted];
      if (i) slide.addShape('line', {x:x + 0.25, y:top - 0.05, w:w - 0.5, h:0, line:{color:C.border, width:0.5}});
      slide.addShape('ellipse', {x:x + 0.25, y:top + 0.12, w:0.13, h:0.13, fill:{color}, line:{color, width:0}});
      text(slide, row.title, x + 0.5, top, w - 3.05, 0.37, {fontSize:11, valign:'middle', fit:'shrink'});
      text(slide, `${row.days} ${row.days === 1 ? 'day' : 'days'} · ${row.stage}`, x + w - 2.5, top, 2.25, 0.37, {fontSize:10, color:C.muted, align:'right', valign:'middle'});
    });
  }

  function people(pptx, v) {
    const slide = frame(pptx, v, 9, 'Workforce', `Current roster and ${v.monthName} packed tonnage per team and the stickers shift · for information`), f = v.workforce;
    if (!f) return unavailable(slide, 'The personnel list was not available when the presentation was created.');
    const cols = columns(4);
    [['Active people', f.active, C.amber], ['Automatic line', f.auto, C.teal], ['Manual packing', f.manual, C.blue], ['Stickers', f.stickers, C.pink]]
      .forEach(([title, value, color], i) => card(slide, {...cols[i], y:1.95, h:1.45, title, value, unit:'people', color, size:26}));
    const leftW = 7.4, x = M + leftW + GAP, w = RIGHT - x, head = {bold:true, color:C.muted, fontSize:10};
    box(slide, M, 3.62, leftW, 3.18);
    label(slide, 'Teams and Stickers', M + 0.25, 3.79, leftW - 0.5);
    const cell = (value, options = {}) => ({text:String(value), options:{fontFace:FONT, fontSize:12, color:C.text, valign:'middle', ...options}});
    slide.addTable([
      ['Team', 'People', 'Automatic', 'Manual', 'Packed', 't / person'].map((value, i) => cell(value, {...head, align:i ? 'right' : 'left'})),
      ...f.teams.map(row => [cell(row.team, {bold:true}), cell(row.people, {align:'right'}), cell(row.auto, {align:'right', color:C.teal}), cell(row.manual, {align:'right', color:C.blue}),
        cell(row.packedT + ' t', {align:'right'}), cell(row.perPersonT, {align:'right', bold:true, color:C.amber})])
    ], {x:M + 0.25, y:4.15, w:leftW - 0.5, colW:[1.5, 1.0, 1.1, 1.0, 1.35, 0.95], rowH:0.37, border:{type:'solid', color:C.border, pt:0.5}, fill:{color:C.panel}, margin:0.05});
    text(slide, `Headcount is the current roster. Staff ${f.staff} (automatic + manual + stickers) packed ${f.packedT} t: ${f.perPersonT} t per person.`,
      M + 0.25, 6.45, leftW - 0.5, 0.3, {fontSize:9, color:C.muted});
    box(slide, x, 3.62, w, 3.18);
    label(slide, 'Packed tonnage per person', x + 0.25, 3.79, w - 0.5);
    slide.addChart(pptx.ChartType.bar, [{name:'t / person', labels:f.teams.map(row => row.team), values:f.teams.map(row => row.perPerson)}],
      {x:x + 0.15, y:4.1, w:w - 0.3, h:2.6, barDir:'col', barGapWidthPct:70, chartColors:[C.amber], ...chartText,
        showLegend:false, showValue:true, dataLabelColor:C.text, dataLabelFontSize:10, dataLabelFormatCode:'#,##0.0', dataLabelPosition:'outEnd'});
  }

  // improvements: lines "Title: description"; specialLabel names the special production row.
  function build(PptxGenJS, v, {improvements = [], specialLabel = ''} = {}) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = `Packaging & Logistics – ${v.monthName} ${v.year}`;
    pptx.theme = {headFontFace:FONT, bodyFontFace:FONT};
    const items = improvements.map(line => String(line).trim()).filter(Boolean).map(line => {
      const at = line.indexOf(':');
      return at > 0 ? {title:line.slice(0, at).trim(), body:line.slice(at + 1).trim()} : {title:line, body:''};
    });
    cover(pptx, v); overview(pptx, v); performance(pptx, v); reconciliation(pptx, v, String(specialLabel).trim() || 'Special production');
    workload(pptx, v); automaticLine(pptx, v); logistics(pptx, v, items); globalProblems(pptx, v); people(pptx, v);
    return pptx;
  }
  return {build};
})();
