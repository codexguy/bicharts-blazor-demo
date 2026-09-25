// BIC generated chart — Bubble chart [D3]
// host contract v1.12.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// SHARED tooltip helper for hand-drawn D3 charts. Owns POSITIONING and the container
// CHROME (background/border/padding - one run drew a bare-text tooltip
// floating transparent over the bars); you supply the content and decide when to show
// it. The chrome is DEFAULTS on the reused node - restyle via tip.node if a chart
// genuinely needs its own look.
//
// Why this exists: codegen places its tooltip at the cursor (left = clientX + 12) and stops
// there. That is correct until the cursor is near the right or bottom edge, where the tooltip
// runs outside the visual and the host clips it - the reader loses exactly the datum they
// reached for. Measured across the 60 most recent OK generations per environment:
// of the gens that position an HTML tooltip, 8 of 10 in PROD had no clamp or flip at all
// (eight generations over six chart types, tables and flows among them). The same chart
// type did it correctly in one generation and not the next, so this is variance, not
// incapacity - which is why it belongs in a helper rather than in one more sentence of prose.
//
// Contract:
//   var tip = d3.llmTooltip(container);        // container = the element you were handed
//   tip.show('<b>Label</b><br/>42', event);    // HTML string or plain text
//   tip.move(event);                           // on mousemove
//   tip.hide();                                // on mouseout
//   tip.html('<b>Label</b>') / tip.text('42')  // set the content WITHOUT showing (see below)
// The node is pointer-events:none and lives inside the container, so it cannot steal a click
// from a d3-mark and it cannot escape the visual. Safe to call repeatedly - one node per
// container is created and reused.
//
// THE ONE CASE CLAMPING CANNOT FIX: a container SHORTER than the tooltip. On a banner tile
// (1390x29 observed) the box does not fit at any offset, so the flip-and-clamp above only
// chooses which end gets sliced. Where the host offers a tooltip surface of its own - painted
// OUTSIDE the visual, which is the only place with room - the helper hands the content over and
// draws nothing. Hosts without one are unaffected: the lookup finds no bridge and the local
// tooltip is drawn exactly as before.
d3.llmTooltip = function (container, opts) {
  opts = opts || {};
  var gap = opts.gap == null ? 12 : opts.gap;    // distance from the cursor
  var edge = opts.edge == null ? 4 : opts.edge;  // minimum distance from the container edge
  var routed = false;                            // true while the HOST is showing our content
  var lastContent = '';                          // what to re-send if the host is driving
  var lastEv = null;                             // where the cursor last was, for a re-fit

  var host = (container && typeof container.node === 'function') ? container.node() : container;
  var noop = { show: function () { return this; }, move: function () { return this; }, hide: function () { return this; },
               html: function () { return this; }, text: function () { return this; }, node: null };
  if (!host || !host.appendChild) return noop;

  // An <svg> cannot host an HTML child; mount on its parent instead.
  var mount = host;
  if (mount.tagName && String(mount.tagName).toLowerCase() === 'svg' && mount.parentNode) {
    mount = mount.parentNode;
  }
  if (!mount || !mount.appendChild) return noop;

  // Absolute placement is measured from the nearest positioned ancestor, so the mount must be
  // one. Only promote a STATIC element - never clobber a layout the chart chose deliberately.
  try {
    var pos = (typeof getComputedStyle === 'function') ? getComputedStyle(mount).position : '';
    if (!pos || pos === 'static') mount.style.position = 'relative';
  } catch (e) { /* jsdom / exec-gate: no layout engine, positioning is inert anyway */ }

  var tip = mount.__llmTip;
  if (!tip || tip.parentNode !== mount) {
    tip = document.createElement('div');
    tip.className = 'llm-tooltip';
    tip.style.position = 'absolute';
    // PARK IT AT THE ORIGIN. An absolutely-positioned element with left/top unset resolves to its STATIC position - directly below the SVG - and visibility:hidden still OCCUPIES SPACE. So the resting node quietly added its own padding+border to the container scrollHeight on every chart that builds a tooltip. Invisible while the host clipped overflow; the day the host began MEASURING overflow it became a scrollbar on charts that fit perfectly (18px of phantom content on a 620px chart). place() overwrites both on first show, so this costs nothing.
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.pointerEvents = 'none';
    tip.style.visibility = 'hidden';
    tip.style.zIndex = '20';
    tip.style.boxSizing = 'border-box';
    tip.style.whiteSpace = opts.wrap ? 'normal' : 'nowrap';
    // Container chrome. SOLID background on purpose (the Plotly hoverlabel-alpha lesson:
    // a translucent tooltip over dense marks is unreadable exactly where it is needed).
    // Light panel + dark text reads on any chart theme because it is a floating surface,
    // not part of the canvas.
    tip.style.background = 'rgba(255,255,255,0.97)';
    tip.style.border = '1px solid rgba(0,0,0,0.28)';
    tip.style.borderRadius = '4px';
    tip.style.padding = '6px 9px';
    tip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.22)';
    tip.style.color = '#222';
    tip.style.fontSize = '12px';
    mount.appendChild(tip);
    mount.__llmTip = tip;
  }

  // The host's tooltip surface, if this container sits inside one that offers it. Looked up on
  // the CONTAINER CHAIN rather than on window, so two charts sharing a frame can never pick up
  // each other's bridge. Resolved per call: a host may install it after the chart is built.
  function hostTip() {
    try {
      var n = mount, guard = 0;
      while (n && guard++ < 8) {
        if (n.__lchHostTip && typeof n.__lchHostTip.show === 'function') return n.__lchHostTip;
        n = n.parentNode;
      }
    } catch (e) { /* detached node / cross-document parent */ }
    return null;
  }

  function metrics() {
    var w = 0, h = 0, cw = 0, ch = 0;
    try {
      var r = mount.getBoundingClientRect();
      cw = r.width; ch = r.height;
    } catch (e) { /* fall through to the client* fallbacks */ }
    if (!cw) cw = mount.clientWidth || 0;
    if (!ch) ch = mount.clientHeight || 0;
    w = tip.offsetWidth || 0;
    h = tip.offsetHeight || 0;
    return { w: w, h: h, cw: cw, ch: ch };
  }

  // Cursor position in MOUNT coordinates. offsetX/offsetY are relative to the event target
  // (a mark, not the container), so they are the wrong basis - convert from client coords.
  function local(ev) {
    var x = 0, y = 0;
    try {
      var r = mount.getBoundingClientRect();
      if (ev && ev.clientX != null) { x = ev.clientX - r.left; y = ev.clientY - r.top; }
    } catch (e) {
      if (ev && ev.clientX != null) { x = ev.clientX; y = ev.clientY; }
    }
    return { x: x, y: y };
  }

  function place(ev) {
    var m = metrics();
    if (!m.cw || !m.ch) return;              // no layout to clamp against (exec gate)
    var p = local(ev);

    // Prefer below-right of the cursor; FLIP to the other side when that would overflow, then
    // CLAMP so a tooltip wider or taller than the container still starts inside it.
    var left = p.x + gap;
    if (left + m.w > m.cw - edge) left = p.x - gap - m.w;
    if (left < edge) left = edge;
    if (left + m.w > m.cw - edge) left = Math.max(edge, m.cw - m.w - edge);

    var top = p.y + gap;
    if (top + m.h > m.ch - edge) top = p.y - gap - m.h;
    if (top < edge) top = edge;
    if (top + m.h > m.ch - edge) top = Math.max(edge, m.ch - m.h - edge);

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  // EITHER ARGUMENT ORDER. The contract is show(content, event); called as show(event, content)
  // the box read "[object MouseEvent]" parked in the corner, and that call has been seen in an
  // archetype, in a served sample and in a few percent of generations. An Event is unmistakable
  // (a clientX, a type, a target) and a content never looks like one, so the helper swaps the
  // two rather than print the event. An ARRAY of lines is a content too - one line per entry.
  function looksLikeEvent(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x)
      && (typeof x.clientX === 'number' || typeof x.type === 'string' || ('target' in x));
  }

  // THE ONE PLACE CONTENT IS WRITTEN, so show(content), html() and text() can never disagree about
  // what the host is re-sent. asText writes textContent whatever the string holds, as a d3
  // selection's .text() does.
  function setContent(content, asText) {
    if (Array.isArray(content)) content = content.map(function (x) { return x == null ? '' : String(x); }).join(asText ? ' ' : '<br/>');
    lastContent = content == null ? '' : String(content);
    if (!asText && typeof content === 'string' && content.indexOf('<') >= 0) tip.innerHTML = lastContent;
    else tip.textContent = lastContent;
  }

  // CONTENT WITHOUT A SHOW: tip.html(content) and tip.text(content). A d3 selection is driven that
  // way, so codegen writes it - tip.show(); tip.move(event); tip.html('...') - and on a handle with
  // only show/move/hide every hover threw after show() had made the EMPTY box visible. The content
  // is set exactly as show(content) sets it. A tooltip already on screen is re-fitted to the new
  // content where it stands (the host's surface gets the new content; ours is re-measured and
  // re-placed at the last cursor position); a hidden one STAYS hidden - showing is show()'s job.
  // With no argument each reads the content back, as a d3 selection's getter does.
  function setAndRefit(self, content, asText) {
    setContent(content, asText);
    if (routed) {
      var hbSet = hostTip();
      if (hbSet && hbSet.show(lastContent, lastEv) === true) return self;
      routed = false;                          // the host let go: the tooltip is still on screen, so draw ours
      return self.show(null, lastEv);
    }
    if (tip.style.visibility === 'visible') return self.show(null, lastEv);
    return self;
  }

  return {
    node: tip,
    html: function (content) { return arguments.length ? setAndRefit(this, content, false) : lastContent; },
    text: function (content) { return arguments.length ? setAndRefit(this, content, true) : (tip.textContent || ''); },
    show: function (content, ev) {
      if (looksLikeEvent(content) && !looksLikeEvent(ev)) { var swapped = content; content = ev; ev = swapped; }
      if (ev) lastEv = ev;
      if (content != null) setContent(content, false);
      // Measure the NATURAL box FIRST. "Does it fit?" is a question about the container, not
      // about the clamp we are deciding whether to apply - measured after clamping, everything
      // always fits and the question can never be answered.
      tip.style.maxWidth = 'none';
      tip.style.visibility = 'visible';      // measurable BEFORE placing
      var m = metrics();
      if (m.ch && m.h + (2 * edge) > m.ch) {
        var hbShow = hostTip();
        // The host may decline - the reader switched tooltips off, or it is already showing its
        // own from the row data. Then we draw ours: clipped still beats absent.
        if (hbShow && hbShow.show(lastContent, ev) === true) {
          routed = true;
          tip.style.visibility = 'hidden';
          return this;
        }
      }
      routed = false;
      // A tooltip can never be wider than the space it must fit in.
      if (m.cw) tip.style.maxWidth = Math.max(80, m.cw - (2 * edge)) + 'px';
      place(ev);
      return this;
    },
    move: function (ev) {
      if (ev) lastEv = ev;
      if (routed) { var hbMove = hostTip(); if (hbMove) hbMove.move(ev); return this; }
      if (tip.style.visibility === 'visible') place(ev);
      return this;
    },
    hide: function () {
      if (routed) { var hbHide = hostTip(); if (hbHide) hbHide.hide(); routed = false; }
      tip.style.visibility = 'hidden';
      return this;
    }
  };
};
function render(container, data, options) {
  container.replaceChildren();

  const width = options.width;
  const height = options.height;
  const themeFg = options.themeFg || 'currentColor';
  const cultureCode = options.cultureCode || 'en-US';
  const noDataText = (options && typeof options.noDataText === 'string' && options.noDataText) ? options.noDataText : 'No data to display';

  const columns = data.columns || [];
  const rows = data.rows || [];

  function colIdx(name) { return columns.findIndex(c => c.name === name); }
  const stateIdx = colIdx('State');
  const regionIdx = colIdx('Region');
  const revIdx = colIdx('Revenue');
  const ordIdx = colIdx('Orders');
  const rrIdx = colIdx('ReturnRate');

  if (revIdx === -1) throw new Error('INVALID:column "Revenue" not found');
  if (rrIdx === -1) throw new Error('INVALID:column "ReturnRate" not found');
  if (ordIdx === -1) throw new Error('INVALID:column "Orders" not found');
  if (regionIdx === -1) throw new Error('INVALID:column "Region" not found');
  if (stateIdx === -1) throw new Error('INVALID:column "State" not found');

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  function drawEmpty() {
    svg.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', themeFg)
      .style('font-size', 12)
      .text(noDataText);
  }

  const filtered = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rev = +r[revIdx], ord = +r[ordIdx], rr = +r[rrIdx];
    const st = r[stateIdx], rg = r[regionIdx];
    if (!Number.isFinite(rev) || !Number.isFinite(ord) || !Number.isFinite(rr)) continue;
    if (st == null || rg == null) continue;
    if (ord < 0) continue;
    filtered.push({ i, rev, ord, rr, st: String(st), rg: String(rg) });
  }

  if (filtered.length === 0) { drawEmpty(); return; }

  const fmtCompact = new Intl.NumberFormat(cultureCode, { notation: 'compact', maximumFractionDigits: 1 });
  const fmtInt = new Intl.NumberFormat(cultureCode, { maximumFractionDigits: 0 });
  const fmtPctNum = new Intl.NumberFormat(cultureCode, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPct = v => (Number.isFinite(v) ? fmtPctNum.format(v) : fmtPctNum.format(0)) + '%';

  // color domain: Region, ordered by aggregate Revenue desc
  const revByRegion = d3.rollups(filtered, v => d3.sum(v, d => d.rev), d => d.rg)
    .sort((a, b) => d3.descending(a[1], b[1]));
  const cats = revByRegion.map(d => d[0]);

  const basePalette = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948'];
  const scheme = options.palette?.length ? options.palette : basePalette;
  function buildColors(n) {
    const out = scheme.slice(0, n);
    let round = 1;
    while (out.length < n) {
      const src = d3.color(scheme[out.length % scheme.length]);
      const hsl = d3.hsl(src);
      hsl.h = (hsl.h + round * 37) % 360;
      out.push(hsl.formatHex());
      if (out.length % scheme.length === 0) round++;
    }
    return out;
  }
  const colors = buildColors(cats.length);
  const colorOf = d3.scaleOrdinal(cats, colors);

  const rowIdxByRegion = new Map();
  cats.forEach(c => rowIdxByRegion.set(c, []));
  filtered.forEach(d => { if (rowIdxByRegion.has(d.rg)) rowIdxByRegion.get(d.rg).push(d.i); });

  // legend column sizing
  function textWidthEstimate(str, fontSize) { return String(str).length * fontSize * 0.6; }
  const legendFont = 11;
  let widestLabelPx = 0;
  cats.forEach(c => { widestLabelPx = Math.max(widestLabelPx, textWidthEstimate(c, legendFont)); });
  const legendW = Math.max(96, Math.min(width * 0.22, widestLabelPx + 40));

  const marginLeft = 58;
  const marginRight = legendW + 16;
  const marginTop = 16;
  const marginBottom = 52;

  const plotW = Math.max(50, width - marginLeft - marginRight);
  const plotH = Math.max(50, height - marginTop - marginBottom);

  const g = svg.append('g').attr('transform', `translate(${marginLeft},${marginTop})`);

  // x scale: Revenue
  const revExtent = d3.extent(filtered, d => d.rev);
  const revPad = (revExtent[1] - revExtent[0]) * 0.1 || revExtent[1] * 0.1 || 1;
  const xDomain = [Math.max(0, revExtent[0] - revPad), revExtent[1] + revPad * 2.5];
  const x = d3.scaleLinear().domain(xDomain).nice().range([0, plotW]);
  x.domain([Math.max(0, x.domain()[0]), x.domain()[1]]);

  // y scale: ReturnRate
  const rrExtent = d3.extent(filtered, d => d.rr);
  const rrPad = (rrExtent[1] - rrExtent[0]) * 0.12 || 1;
  const yDomain = [Math.max(0, rrExtent[0] - rrPad), rrExtent[1] + rrPad];
  const y = d3.scaleLinear().domain(yDomain).nice().range([plotH, 0]);
  y.domain([Math.max(0, y.domain()[0]), y.domain()[1]]);

  // size scale: Orders (zero-anchored, capped max radius by available room)
  const maxOrders = d3.max(filtered, d => d.ord) || 1;
  const minOrders = d3.min(filtered, d => d.ord) || 0;
  const medOrders = d3.median(filtered, d => d.ord) || 0;
  const rMax = Math.max(6, Math.min(20, Math.sqrt((plotW * plotH) / filtered.length) / 2.2));
  const rFloor = Math.max(2.5, rMax * 0.12);
  const sizeScale = d3.scaleSqrt().domain([0, maxOrders]).range([rFloor, rMax]);

  // gridlines (behind marks, faint, no pointer capture)
  const gridG = g.append('g').style('pointer-events', 'none');
  gridG.selectAll('line.gy').data(y.ticks(6)).join('line')
    .attr('class', 'gy')
    .attr('x1', 0).attr('x2', plotW)
    .attr('y1', d => y(d)).attr('y2', d => y(d))
    .attr('stroke', themeFg).attr('stroke-opacity', 0.12);
  gridG.selectAll('line.gx').data(x.ticks(6)).join('line')
    .attr('class', 'gx')
    .attr('y1', 0).attr('y2', plotH)
    .attr('x1', d => x(d)).attr('x2', d => x(d))
    .attr('stroke', themeFg).attr('stroke-opacity', 0.12);

  // axes
  const xAxis = d3.axisBottom(x).ticks(6).tickFormat(d => '$' + fmtCompact.format(d));
  const yAxis = d3.axisLeft(y).ticks(6).tickFormat(d => fmtPct(d));

  const xAxisG = g.append('g').attr('transform', `translate(0,${plotH})`).call(xAxis);
  xAxisG.selectAll('text').attr('fill', themeFg).style('font-size', 10);
  xAxisG.selectAll('line,path').attr('stroke', themeFg).attr('stroke-opacity', 0.4);

  const yAxisG = g.append('g').call(yAxis);
  yAxisG.selectAll('text').attr('fill', themeFg).style('font-size', 10);
  yAxisG.selectAll('line,path').attr('stroke', themeFg).attr('stroke-opacity', 0.4);

  g.append('text')
    .attr('x', plotW / 2).attr('y', plotH + 40)
    .attr('text-anchor', 'middle').attr('fill', themeFg)
    .style('font-size', 11)
    .text('Revenue ($)');

  g.append('text')
    .attr('transform', `translate(${-42},${plotH / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').attr('fill', themeFg)
    .style('font-size', 11)
    .text('ReturnRate (%)');

  // reference line: mean ReturnRate across plotted states
  const meanRR = d3.mean(filtered, d => d.rr);
  const refG = g.append('g').style('pointer-events', 'none');
  refG.append('line')
    .attr('x1', 0).attr('x2', plotW)
    .attr('y1', y(meanRR)).attr('y2', y(meanRR))
    .attr('stroke', themeFg).attr('stroke-opacity', 0.55)
    .attr('stroke-width', 1.3)
    .attr('stroke-dasharray', '5,4');
  const refLabel = 'Mean ReturnRate: ' + fmtPct(meanRR);
  const refLabelW = textWidthEstimate(refLabel, 10) + 8;
  refG.append('rect')
    .attr('x', 2).attr('y', y(meanRR) - 15)
    .attr('width', refLabelW).attr('height', 14)
    .attr('fill', options.themeBg || '#ffffff').attr('fill-opacity', 0.75);
  refG.append('text')
    .attr('x', 6).attr('y', y(meanRR) - 4)
    .attr('fill', themeFg).style('font-size', 10)
    .text(refLabel);

  // bubbles
  const marksG = g.append('g');
  const tipAvail = (options.allowTooltips !== false) && typeof d3.llmTooltip === 'function';
  const tip = tipAvail ? d3.llmTooltip(container) : null;

  const circles = marksG.selectAll('circle.d3-mark')
    .data(filtered)
    .join('circle')
    .attr('class', 'd3-mark')
    .attr('data-row-idx', d => d.i)
    .style('cursor', 'pointer')
    .attr('cx', d => x(d.rev))
    .attr('cy', d => y(d.rr))
    .attr('r', d => sizeScale(d.ord))
    .attr('fill', d => colorOf(d.rg))
    .attr('fill-opacity', 0.7)
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 1);

  circles.append('title')
    .text(d => `${d.st}\nRegion: ${d.rg}\nRevenue: $${fmtInt.format(d.rev)}\nOrders: ${fmtInt.format(d.ord)}\nReturnRate: ${fmtPct(d.rr)}`);

  if (tipAvail) {
    circles
      .on('mousemove', (event, d) => {
        tip.show(`<b>${d.st}</b><br/>Region: ${d.rg}<br/>Revenue: $${fmtInt.format(d.rev)}<br/>Orders: ${fmtInt.format(d.ord)}<br/>ReturnRate: ${fmtPct(d.rr)}`, event);
      })
      .on('mouseleave', () => tip.hide());
  }

  // category legend (outside plot, right gutter)
  const legendX = marginLeft + plotW + 16;
  let cursorY = marginTop + 4;
  const legend = svg.append('g').attr('transform', `translate(${legendX},0)`);

  legend.append('text')
    .attr('x', 0).attr('y', cursorY + 10)
    .attr('fill', themeFg).style('font-size', 11).style('font-weight', 600)
    .text('Region');
  cursorY += 10 + 14;

  const legendCats = cats.slice(0, 12);
  legendCats.forEach(cat => {
    const rowIdxs = (rowIdxByRegion.get(cat) || []).join(',');
    const entryG = legend.append('g')
      .attr('class', 'd3-legend-mark')
      .attr('data-row-idx', rowIdxs)
      .style('cursor', 'pointer')
      .attr('transform', `translate(0,${cursorY})`);
    entryG.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', 12).attr('height', 12)
      .attr('fill', colorOf(cat));
    entryG.append('text')
      .attr('x', 18).attr('y', 10)
      .attr('fill', themeFg).style('font-size', legendFont)
      .text(cat);
    cursorY += 12 + 8;
  });

  // size legend (observed min/median/max Orders), stacked below category legend
  cursorY += 10;
  legend.append('text')
    .attr('x', 0).attr('y', cursorY + 10)
    .attr('fill', themeFg).style('font-size', 11).style('font-weight', 600)
    .text('Orders (size)');
  cursorY += 10 + 12;

  const sizeVals = [minOrders, medOrders, maxOrders].filter((v, i, arr) => arr.indexOf(v) === i);
  const availableH = height - cursorY - 10;
  const maxKeyR = Math.min(rMax, 14);
  const rowPitch = maxKeyR * 2 + 10;
  const maxRows = Math.max(1, Math.floor(availableH / rowPitch));
  const shownSizeVals = sizeVals.slice(0, maxRows);

  shownSizeVals.forEach(v => {
    const r = Math.min(sizeScale(v), maxKeyR);
    const rowCenterY = cursorY + maxKeyR;
    legend.append('circle')
      .attr('cx', maxKeyR).attr('cy', rowCenterY)
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', themeFg).attr('stroke-opacity', 0.55)
      .attr('stroke-width', 1);
    legend.append('text')
      .attr('x', maxKeyR * 2 + 10).attr('y', rowCenterY + 4)
      .attr('fill', themeFg).style('font-size', 10)
      .text(fmtInt.format(v));
    cursorY += rowPitch;
  });
}
