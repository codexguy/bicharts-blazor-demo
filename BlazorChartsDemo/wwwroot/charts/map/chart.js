// BIC generated chart — USA Choropleth (by state) [D3]
// host contract v1.12.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// SHARED value-channel resolver. Answers ONE question for any chart that reduces rows to a
// value per group: WHICH COLUMN CARRIES THE NUMBER? It draws nothing and it decides nothing
// about geometry, exactly like the bounded-scale resolver does for the gauge family.
//
// WHY THIS EXISTS, and it is not a tidy-up. Every chart that needed a value used to write
//
//     const measIdx = columns.findIndex(c => c.isMeasure);
//     const mv = measIdx >= 0 ? row[measIdx] : 1;
//
// and that is wrong twice over. `isMeasure` is true ONLY for a column bound in the measures
// role; a numeric column bound as a category arrives with isMeasure false and every one of its
// statistics intact, so the flag alone throws away a perfectly good measure. And the fallback
// then substitutes the literal 1, which does not fail - it fabricates. Every group aggregates
// to the same number, a colour ramp collapses to a single tone with a legend annotated 1 at
// both ends, a width scale hands every mark its maximum, and the chart renders cleanly, passes
// every execution gate and answers a question nobody asked. A silent constant is far worse than
// a missing channel, because nothing downstream can tell it apart from real data.
//
// CONTRACT
//   const V = d3.llmValueColumn(columns, rows, { countLabel: 'Rows', exclude: [iLat, iLon] });
//   V.valueIndex   column index of the value, or -1 when the rows are being counted
//   V.valueName    what to PUT ON THE LEGEND - the column's name, or countLabel when counting
//   V.labelIndex   the dimension to label a group with; never the same column as the value
//   V.isCount      true when no value column existed and each row therefore counts as one
//   V.resolvedBy   'measure' | 'numeric' | 'count' - which rule fired, for gates and tooltips
//   V.valueOf(row) the row's numeric contribution, or null for blank. NEVER coerces blank to 0.
//
// Resolution order:
//   0. opts.prefer - a column the CALLER has already resolved, by name or index. Honoured first
//      and without argument. This exists because a lane can REQUIRE this helper be called, and a
//      required call must never be a reason to discard a correct answer the caller already had.
//   1. the first column flagged isMeasure;
//   2. else the first NUMERIC column that is neither host-injected, nor the label, NOR AN
//      IDENTIFIER - a measure the user bound as a category is still the measure they meant, but
//      a ZIP code, a FIPS code or an order number is a NAME WRITTEN IN DIGITS and summing it
//      produces a chart that renders cleanly and means nothing;
//   3. else count the rows, and SAY SO. isCount is the caller's instruction to label the
//      channel as a count rather than borrow a column name for a number that is not that column.
//
// WHY RULE 2 NEEDED THE IDENTIFIER TEST. A US cartogram over ZipCode / City / State / Channel /
// Orders / Revenue arrived with every column isMeasure:false - which is what a dataset well does
// when the user binds fields as categories - so rule 1 found nothing and rule 2 took ZipCode, the
// first numeric. The 51 state tiles were coloured by the SUM OF ZIP CODE, legend reading 42,791
// to 60,294,573, while Revenue went unencoded. It passed every gate, because there is nothing
// wrong with the drawing; the number is just not about anything.
//
// WHAT COUNTS AS AN IDENTIFIER, strongest evidence first:
//   - the host says so: a `geoKind` that is a REGION JOIN CODE (zip / state / county / FIPS /
//     ISO / country). A latitude is numeric, geographic and a real quantity, so coordinate kinds
//     are NOT identifiers;
//   - failing that, the NAME says so AND the data agrees: an id-ish token in the column name
//     (camelCase and underscore both split, so `ZipCode` and `zip_code` read alike) together
//     with an integer type and near-unique values. All three, because `OrderCount` is an
//     integer, `Revenue` is near-unique, and neither is an identifier.
// A pure uniqueness sniff is deliberately NOT used: Revenue was 9,381 distinct over 10,000 rows.
//
// opts.prefer names the column the caller has ALREADY decided is the value - a name or an index.
// Use it when a lane requires this call but you have resolved the value yourself: the required
// call then CONFIRMS your answer instead of replacing it. Ignored when it names nothing real.
//
// opts.exclude is a list of column INDEXES the caller has already claimed for another channel -
// a flow map resolves its own lat/lon pair out of ordinary named columns, and a latitude drafted
// as the value would be worse than counting. Say what you have taken; the resolver skips it for
// both the value and the label.
//
// An implicit count is legitimate. Reaching it while a real number sits unread is not.
d3.llmValueColumn = function (columns, rows, opts) {
  opts = opts || {};
  var cols = Array.isArray(columns) ? columns : [];
  var data = Array.isArray(rows) ? rows : [];

  // Host-injected columns are plumbing - join keys, row ids, resolved coordinates. They are
  // numeric and they are never what anyone bound, so they can never be a value or a label.
  var isHost = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    return n.indexOf('__') === 0;
  };
  var taken = {};
  (Array.isArray(opts.exclude) ? opts.exclude : []).forEach(function (i) {
    if (i != null && i >= 0) taken[i] = 1;
  });

  var NUMERIC_TYPES = { integer: 1, decimal: 1, double: 1, float: 1, single: 1,
                        number: 1, int64: 1, int32: 1, currency: 1, money: 1 };

  // A column is numeric if the host SAYS so, and otherwise if the rows show it. The declared
  // type is preferred because a sparse column of blanks is still numeric; the sniff is the
  // fallback for a payload that carries no type at all.
  var isNumericCol = function (c, i) {
    var dt = (c && c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (dt) return NUMERIC_TYPES[dt] === 1;
    var seen = 0, num = 0;
    for (var r = 0; r < data.length && seen < 50; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      if (typeof v !== 'boolean' && isFinite(+v)) num++;
    }
    return seen > 0 && num === seen;
  };

  // A GEO JOIN CODE IS A NAME, NOT A NUMBER. Region codes identify; coordinates measure.
  var isRegionCode = function (c) {
    var k = (c && c.geoKind != null) ? String(c.geoKind).toLowerCase() : '';
    if (!k) return false;
    return k.indexOf('zip') === 0 || k.indexOf('us-zip') === 0 || k.indexOf('us-state') === 0 ||
           k.indexOf('us-county') === 0 || k.indexOf('us-fips') === 0 || k.indexOf('fips') === 0 ||
           k.indexOf('country-') === 0 || k.indexOf('iso-') === 0;
  };

  // Split a column name the way a reader does - camelCase AND underscores AND spaces - because a
  // word-boundary test cannot see the `Code` inside `ZipCode`, and glued names are the common case.
  var ID_TOKENS = { id: 1, ids: 1, identifier: 1, code: 1, codes: 1, zip: 1, zipcode: 1,
                    postal: 1, postcode: 1, fips: 1, guid: 1, uuid: 1, sku: 1, upc: 1, ean: 1,
                    isbn: 1, key: 1, num: 1, number: 1, no: 1, ref: 1, serial: 1, barcode: 1,
                    account: 1, acct: 1, vin: 1, imei: 1, ssn: 1 };
  var nameLooksLikeId = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    if (!n) return false;
    var parts = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/);
    for (var p = 0; p < parts.length; p++) {
      if (parts[p] && ID_TOKENS[parts[p].toLowerCase()] === 1) return true;
    }
    return false;
  };

  // The name alone is not enough - `OrderCount` would be a false positive on a token list, and a
  // measure lost to a name test is as wrong as an identifier drafted as a measure. Require the
  // DATA to agree: integer-valued and near-unique, which is what a key looks like and what a
  // quantity almost never does.
  var looksLikeKeyData = function (c, i) {
    var seen = 0, ints = 0, vals = {}, distinct = 0;
    for (var r = 0; r < data.length && seen < 2000; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      var num = +v;
      if (isFinite(num) && Math.floor(num) === num) ints++;
      var kk = String(v);
      if (vals[kk] !== 1) { vals[kk] = 1; distinct++; }
    }
    return seen >= 8 && ints === seen && (distinct / seen) >= 0.9;
  };

  var isIdentifierCol = function (c, i) {
    if (!c) return false;
    // geoKind is DECLARED by the host and is the exact signal, so it is tested first and alone.
    // There is deliberately no second declared flag to consult: formatSignature, the host's other
    // identifier signal, is computed for STRING columns only - which is precisely why a numeric
    // ZIP slipped past every identifier test in the pipeline - and inventing a field nothing
    // populates would be a lever that cannot fire.
    if (isRegionCode(c)) return true;
    return nameLooksLikeId(c) && looksLikeKeyData(c, i);
  };

  // A MEASURE THAT HOLDS TEXT IS NOT A VALUE. Power BI's "First" or "Last" of a name is a measure the
  // host sends as a string: taken as the value, valueOf answers null on every row and the chart draws
  // nothing - the card of dashes nine archetypes were fixed for. The same rule as the server's
  // ChartFilter.IsTextMeasure: DECLARED non-numeric (not a date, not a flag) with no numeric evidence
  // (no spread, sum or mean, not continuous). An untyped measure is still taken: no type is not text.
  var isTextMeasure = function (c) {
    if (!c || !c.isMeasure) return false;
    var dt = (c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (!dt || NUMERIC_TYPES[dt] === 1 || dt === 'datetime' || dt === 'date' || dt === 'boolean') return false;
    if (c.stdDev != null || c.sum != null || c.avgValue != null) return false;
    return String(c.valueNature || '').toLowerCase() !== 'continuous';
  };

  var valueIndex = -1, resolvedBy = 'count';
  var skipped = [];
  var skippedText = [];      // measures passed over because they hold text (isTextMeasure)

  // 0. THE CALLER'S OWN ANSWER WINS. A lane that REQUIRES this call must not thereby cost the
  //    caller a value it had already resolved correctly.
  if (opts.prefer != null) {
    var want = opts.prefer;
    for (var q = 0; q < cols.length; q++) {
      if (!cols[q]) continue;
      if (q === want || (typeof want === 'string' && String(cols[q].name) === want)) {
        if (!taken[q] && !isHost(cols[q])) { valueIndex = q; resolvedBy = 'preferred'; }
        break;
      }
    }
  }

  if (valueIndex < 0) {
    for (var i = 0; i < cols.length; i++) {
      if (taken[i]) continue;
      if (!cols[i] || !cols[i].isMeasure || isHost(cols[i])) continue;
      // SAY WHAT WAS SKIPPED, as the numeric pass does for an identifier.
      if (isTextMeasure(cols[i])) { skippedText.push(String(cols[i].name)); continue; }
      valueIndex = i; resolvedBy = 'measure'; break;
    }
  }
  if (valueIndex < 0) {
    for (var j = 0; j < cols.length; j++) {
      if (taken[j] || !cols[j] || isHost(cols[j])) continue;
      if (!isNumericCol(cols[j], j)) continue;
      if (isIdentifierCol(cols[j], j)) {
        // SAY WHAT WAS SKIPPED. A silent exclusion is how the opposite bug would hide.
        skipped.push(String(cols[j].name));
        continue;
      }
      valueIndex = j; resolvedBy = 'numeric'; break;
    }
  }

  // The label is the first bound column that is NOT the value. Resolving the two together is
  // what stops a numeric column being drafted as the value and then labelling the groups with
  // itself - the two used to be found by separate scans that could agree on the same column.
  var labelIndex = -1;
  for (var k = 0; k < cols.length; k++) {
    if (taken[k] || !cols[k] || isHost(cols[k]) || k === valueIndex) continue;
    labelIndex = k; break;
  }

  var isCount = valueIndex < 0;
  var nameOf = function (idx) {
    var c = cols[idx];
    return (c && c.name != null) ? String(c.name) : '';
  };

  return {
    valueIndex: valueIndex,
    valueName: isCount ? (opts.countLabel || 'Rows') : nameOf(valueIndex),
    labelIndex: labelIndex,
    labelName: labelIndex >= 0 ? nameOf(labelIndex) : '',
    isCount: isCount,
    resolvedBy: resolvedBy,
    // Columns rule 2 REFUSED as identifiers. Non-empty here beside isCount true means "there were
    // numbers and none of them were quantities" - worth putting in a subtitle rather than hiding.
    skipped: skipped,
    // Measures passed over because they hold TEXT (a "First" of a name): kept apart from `skipped`,
    // which names identifiers, so a caption built from either says the right thing.
    skippedText: skippedText,
    // A BLANK IS NOT A ZERO. Returning null keeps an absent value out of the aggregate and out
    // of the scale domain, so a group present in the data with nothing to show for this view
    // paints as no-data instead of being dragged to the bottom of the ramp.
    valueOf: function (row) {
      if (isCount) return 1;
      if (!row) return null;
      var v = row[valueIndex];
      if (v == null || v === '' || typeof v === 'boolean') return null;
      var n = +v;
      return isFinite(n) ? n : null;
    }
  };
};
// SHARED sequential colour ramp + legend for a map or tile grid that shades each region by ONE
// aggregated value (World and USA choropleths, the hex and world tile-grid cartograms).
//
// Contract:
//   const ramp = d3.llmValueRamp({ values: [...], low, high });
//     values - the aggregates of the regions you DRAW; null / NaN are ignored, never read as 0
//     low, high - the ramp's end colours (the user-forced options.colorScaleLow/High when set)
//   ramp.color(v)   -> colour | null (null for a missing value - paint no-data yourself)
//   ramp.kind       -> 'linear' | 'bands' | 'constant'; ramp.skewed === (ramp.kind === 'bands')
//   ramp.lo, ramp.hi, ramp.median, ramp.p95
//   ramp.edges      -> bands: [lo, t1, .., hi]; otherwise [lo, hi]
//   ramp.colors     -> bands: one colour per band; otherwise [low, high]
//   ramp.drawLegend(parent, { x, y, width, height, labelY, fontSize, fg, fgOpacity, format, id,
//                             stroke, constantText, marks }) -> { width, height }
//     marks - [{ value, label }]: a reference value ON the ramp (a mean, a target) - a dashed tick
//     across the bar and 'label value' in the label row where it clears the others, else a <title>
//     draws <g class="llm-value-ramp" data-kind> at (x, y): a gradient bar (rect.llm-value-ramp-bar,
//     fill url(#id)) or one rect.llm-value-ramp-band per band, and text.llm-value-ramp-label at
//     labelY (default height + fontSize) - both ends always, each inner band edge only where it
//     clears the labels beside it, and for 'constant' the one value followed by constantText.
//
// WHY IT MEASURES FIRST. A linear ramp is right for spread values and defeats skewed ones: a few
// large regions take the top of the scale and the bulk of the map lands on one pale shade -
// accurate and unreadable. So it reads the median and the 95th percentile and picks:
//   * 'linear' when p95 <= 4 x median, when there are fewer than 10 values, or when any value is
//     negative - exactly the gradient these maps always drew;
//   * 'bands' otherwise: up to five EQUAL-COUNT bands (quintile edges at data values, a repeated edge
//     merged, so no band is empty), each
//     a point on the same low->high ramp, and the legend prints the band edges in the measure's own
//     units so a reader can still read a value off a colour.
d3.llmValueRamp = function (cfg) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the legend's labels draw no smaller
  cfg = cfg || {};
  var num = function (v) { return (v == null || v === '' || !isFinite(+v)) ? null : +v; };
  var vals = [];
  (cfg.values || []).forEach(function (v) { v = num(v); if (v != null) vals.push(v); });
  vals.sort(function (a, b) { return a - b; });
  var low = cfg.low || '#eef3f8', high = cfg.high || '#3182bd';
  var n = vals.length;
  var lo = n ? vals[0] : 0, hi = n ? vals[n - 1] : 1;
  var median = n ? d3.quantile(vals, 0.5) : null, p95 = n ? d3.quantile(vals, 0.95) : null;
  var scale = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi] : [lo, hi]).range([low, high]).clamp(true);
  var kind = n && lo === hi ? 'constant' : 'linear', edges = [lo, hi], colors = [low, high];
  if (n >= 10 && lo >= 0 && lo !== hi && p95 > 4 * median) {
    // EDGES ARE DATA VALUES, never interpolated between two: an interpolated quintile can land in a
    // gap in the data and leave a band nobody is in. A band [t, next) then always holds t itself.
    var inner = [];
    for (var q = 1; q < 5; q++) {
      var t = vals[Math.floor(q * n / 5)];
      if (t > lo && (!inner.length || t > inner[inner.length - 1])) inner.push(t);
    }
    // Two inner edges at least: one edge is a two-colour map, which says less than the gradient.
    if (inner.length >= 2) {
      var along = d3.scaleLinear().domain([0, inner.length]).range([low, high]);
      colors = [];
      for (var c = 0; c <= inner.length; c++) colors.push(along(c));
      // A BAND IS FOUND BY BISECTING ITS EDGES: a threshold scale's own rule (t <= v < next) written out.
      // This source is prepended to the generated code before the quality checks run, and a named
      // binned-scale call beside the linear branch's gradient legend read to them as a binned scale under
      // a continuous legend, which rejected every chart that used this helper.
      scale = function (v) { return colors[d3.bisectRight(inner, v)]; };
      edges = [lo].concat(inner, [hi]);
      kind = 'bands';
    }
  }

  var drawLegend = function (parent, o) {
    o = o || {};
    var w = o.width || 120, h = o.height || 8, fs = Math.max(TYPE_FLOOR, o.fontSize || TYPE_FLOOR);
    var fg = o.fg || '#333', op = o.fgOpacity == null ? 1 : o.fgOpacity;
    var ly = o.labelY == null ? h + fs : o.labelY;
    var fmt = typeof o.format === 'function' ? o.format : function (v) { return String(v); };
    var g = parent.append('g').attr('class', 'llm-value-ramp').attr('data-kind', kind)
      .attr('transform', 'translate(' + (o.x || 0) + ',' + (o.y || 0) + ')');
    var label = function (x, anchor, text) {
      g.append('text').attr('class', 'llm-value-ramp-label').attr('x', x).attr('y', ly)
        .attr('text-anchor', anchor).attr('font-size', fs).attr('fill', fg).attr('fill-opacity', op).text(text);
    };
    // THE LABELS THAT FIT. Both ends always; anything else only where its text clears every label
    // already placed, by the 0.58 x font-size run the other helpers estimate with.
    var taken = [];
    var place = function (x, anchor, text, always) {
      var wd = String(text).length * fs * 0.58;
      var x0 = anchor === 'start' ? x : anchor === 'end' ? x - wd : x - wd / 2;
      if (!always && taken.some(function (s) { return x0 < s[1] + 4 && x0 + wd > s[0] - 4; })) return false;
      taken.push([x0, x0 + wd]);
      label(x, anchor, text);
      return true;
    };
    var k = colors.length, sw = w / k;
    if (kind !== 'bands') {
      var id = o.id || ('llmramp-' + Math.abs((w * 131 + h * 7) | 0));
      var lg = g.append('defs').append('linearGradient').attr('id', id);
      lg.append('stop').attr('offset', '0%').attr('stop-color', low);
      lg.append('stop').attr('offset', '100%').attr('stop-color', high);
      var bar = g.append('rect').attr('class', 'llm-value-ramp-bar').attr('width', w).attr('height', h)
        .attr('fill', 'url(#' + id + ')');
      if (o.stroke) bar.attr('stroke', o.stroke).attr('stroke-width', 0.5);
      // ONE VALUE IS NOT A RANGE: printing it as lo..hi invites the reader to see variation the
      // ramp cannot be carrying.
      if (kind === 'constant') {
        label(0, 'start', fmt(lo) + (o.constantText || ''));
        return { width: w, height: Math.max(h, ly) };
      }
      place(0, 'start', fmt(lo), true);
      place(w, 'end', fmt(hi), true);
    } else {
      for (var b = 0; b < k; b++) {
        var r = g.append('rect').attr('class', 'llm-value-ramp-band').attr('x', b * sw).attr('width', sw)
          .attr('height', h).attr('fill', colors[b]).attr('data-from', edges[b]).attr('data-to', edges[b + 1]);
        if (o.stroke) r.attr('stroke', o.stroke).attr('stroke-width', 0.5);
      }
      place(0, 'start', fmt(lo), true);
      place(w, 'end', fmt(hi), true);
    }
    // A REFERENCE VALUE ON THE RAMP (a mean, a target): a dashed tick across the bar where the value
    // sits, and its label in the label row - placed before the inner band edges, and when it would
    // collide the tick carries it as a <title> instead. Never stacked above the bar: that line is the
    // channel name's, and a mean hand-placed there printed through it.
    (o.marks || []).forEach(function (m) {
      var v = num(m && m.value);
      if (v == null) return;
      var x;
      if (kind === 'bands') {
        var bi = Math.max(0, Math.min(k - 1, d3.bisectRight(edges, v) - 1));
        var span = edges[bi + 1] - edges[bi];
        x = (bi + (span > 0 ? Math.max(0, Math.min(1, (v - edges[bi]) / span)) : 0)) * sw;
      } else {
        x = Math.max(0, Math.min(w, (v - lo) / (hi - lo) * w));
      }
      var text = (m.label != null && m.label !== '' ? m.label + ' ' : '') + fmt(v);
      var tick = g.append('line').attr('class', 'llm-value-ramp-mark').attr('x1', x).attr('x2', x)
        .attr('y1', -2).attr('y2', h + 2).attr('stroke', fg).attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '3,2');
      if (!place(x, 'middle', text, false)) tick.append('title').text(text);
    });
    if (kind === 'bands') for (var e = 1; e < k; e++) place(e * sw, 'middle', fmt(edges[e]), false);
    return { width: w, height: Math.max(h, ly) };
  };

  return {
    color: function (v) { v = num(v); return v == null ? null : scale(v); },
    kind: kind, skewed: kind === 'bands', lo: lo, hi: hi, median: median, p95: p95,
    edges: edges, colors: colors, drawLegend: drawLegend,
  };
};
// SHARED label-fit helper for hand-drawn D3 charts that place text INSIDE a mark
// (treemap tiles, icicle bands, funnel stages, stacked-bar segments).
//
// Why this exists: codegen reliably gates a label on the MARK's size and then truncates
// by CHARACTER COUNT, which is a proxy for width that fails exactly where it matters. A
// 40px tile passes a ">= 36px" gate, "Los Angeles" is under a 14-char cap so it is left
// whole, and at 10px it renders ~72px wide - centred, so it spills into the tiles on BOTH
// sides. Measured: 34 of 35 prod treemap/icicle gens that draw text never
// measure it.
//
// Contract: call AFTER .text(...) and after font-size is set, with an accessor for the
// space available to that datum. Truncates to the widest prefix that actually fits, and
// blanks the label outright when even one character + the ellipsis will not.
//
// opts.text (string or accessor) - THE AUTHORITATIVE LABEL FOR THIS CALL, and REQUIRED on any
// chart whose text CHANGES between calls. By default the helper caches the original string so a
// re-fit (resize, proofread re-render) works from the full text instead of eroding an already
// clipped one; that is right for a resize and wrong for an animation tick, where a value line is
// a different string every frame. Without opts.text an animated label would be restored to
// frame 0's string and held there - a stale number wearing the look of a label bug.
d3.llmFitLabel = function (sel, widthAccessor, opts) {
  opts = opts || {};
  var pad = opts.pad == null ? 4 : opts.pad;
  var minWidth = opts.minWidth == null ? 14 : opts.minWidth;
  var ell = opts.ellipsis == null ? '…' : opts.ellipsis;
  var fallbackFs = opts.fontSize == null ? 10 : opts.fontSize;
  // SHRINK BEFORE YOU CUT (opts.shrinkTo, a font size in px). A label that is WIDER than its room
  // is not always a label that should be cut: '180,000 of 200,000' truncated to '180,000 of 2...'
  // is a different number, and a ring's hole is a circle whose chord at the label's baseline is
  // most of what it has. When shrinkTo is given, the helper first reduces the node's font-size
  // from its current value toward shrinkTo until the FULL text fits, and only if it still does
  // not fit at the floor falls through to the cut. The original size is remembered so a re-fit
  // on a wider tile grows the label back rather than leaving it small.
  // opts.overflow: 'truncate' (default, the behaviour every existing caller has) or 'drop' -
  // blank the label rather than cut it, for text whose truncation would state something false.
  var shrinkTo = opts.shrinkTo == null ? null : +opts.shrinkTo;
  var overflow = opts.overflow === 'drop' ? 'drop' : 'truncate';

  if (!sel || typeof sel.each !== 'function') return sel;

  // A CUT NEVER LANDS INSIDE A NUMBER. The widest prefix that fits is right for a word and wrong for a
  // number: 'largest 12...' of 'largest 128 of 400' and '1,234,5...' of '1,234,567' read as different
  // values, and the ellipsis does not say which digits went. So a cut that would split a number - between
  // two digits, at a group or decimal separator between digits, or before a unit or percent sign glued to
  // the digits - moves back to before that number and its sign or currency symbol; a label that is only
  // the number is blanked, as overflow 'drop' would. Every caller gets this, model-written code included,
  // so a caption built from a raw count ('largest ' + n) can no longer state a different count.
  var DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\uFF10-\uFF19]/;
  var JOIN = /[.,'\u00A0\u202F\u2019\u066B\u066C]/;
  var GLUED = /[A-Za-z%\u2030]/;
  var LEAD = /[+\-\u2212$\u20AC\u00A3\u00A5\u20B9]/;
  function numberSafeCut(s, lo) {
    if (!(lo > 0) || lo >= s.length) return lo;
    var a = s.charAt(lo - 1), b = s.charAt(lo);
    var splits = DIGIT.test(a)
      ? (DIGIT.test(b) || GLUED.test(b) || (JOIN.test(b) && DIGIT.test(s.charAt(lo + 1))))
      : (lo >= 2 && JOIN.test(a) && DIGIT.test(s.charAt(lo - 2)) && DIGIT.test(b));
    if (!splits) return lo;
    var i = lo;
    while (i > 0 && (DIGIT.test(s.charAt(i - 1))
                     || (i >= 2 && JOIN.test(s.charAt(i - 1)) && DIGIT.test(s.charAt(i - 2))))) i--;
    while (i > 0 && LEAD.test(s.charAt(i - 1))) i--;
    while (i > 0 && /\s/.test(s.charAt(i - 1))) i--;
    return i;
  }

  function fontSizeOf(node) {
    try {
      var a = parseFloat(node.getAttribute && node.getAttribute('font-size'));
      if (a > 0) return a;
      var s = node.style && node.style.fontSize ? parseFloat(node.style.fontSize) : NaN;
      if (s > 0) return s;
    } catch (e) { /* fall through */ }
    return fallbackFs;
  }

  function setFontSize(node, fs) {
    try { if (node.setAttribute) node.setAttribute('font-size', String(fs)); } catch (e) { /* detached */ }
  }

  // Real metrics in a browser; a conservative estimate anywhere that lacks SVG text
  // measurement (the jsdom exec-gate sidecar has no getComputedTextLength, and a
  // detached node can legitimately report 0) - never throw, never assume it fits.
  function measure(node, txt) {
    try {
      if (typeof node.getComputedTextLength === 'function') {
        var w = node.getComputedTextLength();
        if (w > 0) return w;
      }
    } catch (e) { /* fall through */ }
    return String(txt).length * fontSizeOf(node) * 0.6;
  }

  sel.each(function (d, i) {
    var node = this;
    // Re-runnable: keep the ORIGINAL text so a second pass (proofread re-render, resize) re-fits
    // from the full string instead of eroding an already-clipped one. An animated chart supplies
    // opts.text instead, because its label is a NEW string each frame rather than the same one
    // re-measured - see the header.
    var full;
    if (opts.text != null) {
      try {
        full = typeof opts.text === 'function' ? opts.text.call(node, d, i) : opts.text;
      } catch (e) { full = ''; }
      full = full == null ? '' : String(full);
      node.__llmFullLabel = full;
      node.textContent = full;              // authoritative: an EMPTY label must CLEAR the node,
      if (!full) return;                    // never leave the previous frame's text standing
    } else {
      full = node.__llmFullLabel;
      if (full == null) {
        full = node.textContent == null ? '' : String(node.textContent);
        node.__llmFullLabel = full;
      }
      if (!full) return;
    }

    var room;
    try {
      room = typeof widthAccessor === 'function'
        ? widthAccessor.call(node, d, i)
        : widthAccessor;
    } catch (e) { room = 0; }
    room = (room == null ? 0 : +room) - pad * 2;

    if (!(room > 0) || room < minWidth) { node.textContent = ''; return; }

    // Start every fit from the ORIGINAL size, for the same reason the original TEXT is kept:
    // a re-fit must be able to undo a shrink, not only deepen one.
    if (shrinkTo != null) {
      if (node.__llmFullFontSize == null) node.__llmFullFontSize = fontSizeOf(node);
      setFontSize(node, node.__llmFullFontSize);
    }
    node.textContent = full;
    var w = measure(node, full);
    if (w <= room) return;                                // fits whole - done

    if (shrinkTo != null && shrinkTo > 0) {
      var cur = fontSizeOf(node);
      if (cur > shrinkTo) {
        // Width is close to linear in font size, so the first guess lands within a step of
        // the answer; walk down in half-pixels from there and stop at the first size that
        // fits, never below the floor.
        var fs = Math.max(shrinkTo, Math.floor((cur * room / w) * 2) / 2);
        for (; fs >= shrinkTo; fs -= 0.5) {
          setFontSize(node, fs);
          if (measure(node, full) <= room) return;
        }
        setFontSize(node, shrinkTo);
        if (measure(node, full) <= room) return;
      }
    }
    if (overflow === 'drop') { node.textContent = ''; return; }

    // Widest prefix that fits, ellipsis included. Binary search: measure() can be a real
    // layout read, so keep it to ~log2(n) calls per label rather than one per character.
    var lo = 0, hi = full.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      node.textContent = full.slice(0, mid) + ell;
      if (measure(node, node.textContent) <= room) lo = mid; else hi = mid - 1;
    }
    lo = numberSafeCut(full, lo);
    node.textContent = lo > 0 ? full.slice(0, lo) + ell : '';
  });

  return sel;
};
// SHARED zoom/pan helper for D3 charts drawn on a map projection (the geo BUBBLE lanes).
//
// Why this exists: zoom is easy to get wrong in ways that only show up in a HOST. Four
// traps, all handled here so 80 generations do not each rediscover them.
//
//  1. THE WHEEL BELONGS TO THE PAGE. A visual sits inside a scrollable report, so a map
//     that swallows the wheel steals the user's scroll. Embedded maps solved this long ago
//     with cooperative gestures (embedded Google Maps, Mapbox cooperativeGestures): Ctrl or
//     Cmd + wheel zooms, a plain wheel scrolls the page, and a one-line hint appears so the
//     plain wheel does not read as a broken map. One finger scrolls the page; two fingers
//     work the map.
//  2. A PAN MUST NOT CROSS-FILTER. The host resolves clicks with a delegated listener on
//     the container root, so the click synthesised at the end of a drag would select
//     whatever mark sat under the pointer. d3-zoom suppresses that click itself, and
//     clickDistance keeps a few px of wobble a real CLICK so ordinary selection still works.
//  3. FURNITURE MUST NOT MOVE. The legend panel, the annotation stack and the reset control
//     live OUTSIDE the transformed layer, and the layer is clipped to the map area, so
//     nothing can pan out over the panel or the notes.
//  4. SYMBOL SIZE IS NOT GEOGRAPHY. A bubble radius encodes a MEASURE, so it must not grow
//     with the zoom the way a country outline does. The chart gets an onZoom callback and
//     counter-scales its own marks and labels by the transform's k.
//
// Contract: call BEFORE drawing the map, draw into the returned `layer`, and append the
// legend/notes to the SVG afterwards so they paint on top. Returns null (never throws) when
// d3.zoom is absent, and the caller then simply draws into the SVG as before.
d3.llmGeoZoom = function (svg, opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the hint and the pad glyphs draw no smaller
  opts = opts || {};
  if (!svg || typeof svg.append !== 'function') return null;
  if (typeof d3.zoom !== 'function' || typeof d3.zoomIdentity === 'undefined') return null;

  var w = +opts.width, h = +opts.height;
  // ORIGIN of the map band within the SVG. Lanes whose furniture sits to the SIDE
  // (the bubble maps) leave this at 0,0 and nothing changes. A lane whose legend is a
  // TOP BAND (the choropleths) passes the band's own top edge, so the pan catcher, the
  // clip and the d-pad all land inside the map rather than across the legend. NOT
  // applied to `layer`: callers project into absolute SVG coords, and translating the
  // layer would slide every mark off its own projection.
  var ox = +opts.originX || 0, oy = +opts.originY || 0;
  if (!(w > 0) || !(h > 0)) return null;
  var maxScale = +opts.maxScale > 1 ? +opts.maxScale : 8;
  var fg = opts.themeFg || '#333';
  var fs = Math.max(TYPE_FLOOR, +opts.fontSize > 0 ? +opts.fontSize : 11);
  var coop = opts.cooperative === false ? false : true;
  var onZoom = typeof opts.onZoom === 'function' ? opts.onZoom : null;
  var hintText = opts.hintText || 'Use Ctrl (Cmd) + scroll to zoom, or drag to pan';

  // Clip id derived from the viewport - the geo lanes' convention: deterministic, no
  // random, and two visuals that collide are by definition the same size.
  var clipId = 'llmzoomclip-' + Math.abs(((w * 131 + h * 17 + ox * 7 + oy) | 0));
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h);

  var viewport = svg.append('g').attr('clip-path', 'url(#' + clipId + ')');
  // A PAINTED catcher so empty ocean can start a pan. fill 'transparent', never 'none' -
  // an unpainted shape takes no pointer events. It sits UNDER the map content, so marks
  // keep their own clicks.
  viewport.append('rect').attr('class', 'llm-zoom-surface')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h)
    .attr('fill', 'transparent');
  var layer = viewport.append('g');

  // Reset is the pad's CENTRE cell (built below); this holds it so the show/hide and the
  // adopt()-skip keep working. Null on a viewport too small for the pad, hence every use
  // being guarded.
  var ctrl = null;

  // SIX ALWAYS-VISIBLE CONTROLS. Cooperative gestures are the right
  // BEHAVIOUR but they are INVISIBLE: nothing on the chart said the map could move at all,
  // and a reader on a trackpad, a touchpad or a wheel-less mouse had no way to find out.
  // Zoom in/out plus pan left/up/right/down, laid out as a d-pad so each direction reads
  // without a label:
  //     [+] [^] [-]
  //     [<]     [>]
  //         [v]
  // On the SVG ROOT like the rest of the furniture, so the transform never moves them, and
  // OUTSIDE the zoom viewport so a press is a click rather than the start of a pan.
  var PAD_BTN = Math.max(15, Math.min(22, Math.round(fs * 1.7)));
  var PAD_GAP = 2, PAD_W = PAD_BTN * 3 + PAD_GAP * 2;
  var padX = ox + w - PAD_W - 6, padY = oy + 6;
  var pad = null, panBtns = [];
  // Omit rather than overlap: on a tile too small to hold the pad and still be a map, the
  // gesture path is still there and the furniture rule wins (same test the size key uses).
  if (w >= PAD_W + fs * 8 && h >= PAD_BTN * 3 + PAD_GAP * 2 + 16) {
    pad = svg.append('g').attr('class', 'llm-zoom-pad');
    // The centre cell was empty and Reset was a separate box in the opposite corner, so the
    // controls read as two unrelated things. Reset now sits in the middle of its own d-pad
    // - one compact cluster, and the arrows point away from the thing that
    // undoes them.
    var CELLS = [
      [0, 0, 'in', '+'], [1, 0, 'up', '\u2191'], [2, 0, 'out', '\u2212'],
      [0, 1, 'left', '\u2190'], [1, 1, 'reset', '\u27F2'], [2, 1, 'right', '\u2192'],
      [1, 2, 'down', '\u2193']
    ];
    // A named function, not an IIFE: injected helpers are prepended into generated code
    // and face the same CQC pass it does, and d3_iife_wrapper rejects the (function(){})()
    // form. Passing the cell as an argument gives the same per-iteration capture.
    for (var ci = 0; ci < CELLS.length; ci++) addPadButton(CELLS[ci]);
  }
  function addPadButton(cell) {
    {
        var bx = padX + cell[0] * (PAD_BTN + PAD_GAP);
        var by = padY + cell[1] * (PAD_BTN + PAD_GAP);
        var g = pad.append('g').attr('class', 'llm-zoom-btn').style('cursor', 'pointer');
        g.append('rect').attr('x', bx).attr('y', by).attr('rx', 3)
          .attr('width', PAD_BTN).attr('height', PAD_BTN)
          .attr('fill', opts.backgroundColor || '#fff').attr('fill-opacity', 0.85)
          .attr('stroke', fg).attr('stroke-opacity', 0.35);
        g.append('text').attr('x', bx + PAD_BTN / 2).attr('y', by + PAD_BTN / 2)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', Math.max(TYPE_FLOOR, PAD_BTN - 6)).attr('fill', fg)
          .style('pointer-events', 'none').text(cell[3]);
        g.on('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          llmZoomStep(cell[2]);
        });
        // The arrows do nothing at k=1 (translateExtent pins the fitted frame), so they
        // start dimmed - a control that looks live and is not is worse than none.
        if (cell[2] === 'reset') { ctrl = g; g.style('opacity', 0.35); panBtns.push(g); }
        else if (cell[2] !== 'in' && cell[2] !== 'out') { g.style('opacity', 0.35); panBtns.push(g); }
    }
  }

  var hint = svg.append('g').style('display', 'none').style('pointer-events', 'none');
  hint.append('rect').attr('x', ox + w / 2 - fs * 12).attr('y', oy + h / 2 - fs).attr('rx', 4)
    .attr('width', fs * 24).attr('height', fs * 2)
    .attr('fill', fg).attr('fill-opacity', 0.72);
  hint.append('text').attr('x', ox + w / 2).attr('y', oy + h / 2 + fs * 0.4)
    .attr('text-anchor', 'middle').attr('font-size', fs)
    .attr('fill', opts.backgroundColor || '#fff').text(hintText);

  var hintTimer = null;
  function showHint() {
    try {
      hint.raise().style('display', null).style('opacity', 1);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { hint.style('display', 'none'); }, 1500);
    } catch (e) { /* a hint is never worth breaking the chart for */ }
  }

  // COOPERATIVE GESTURE FILTER. Returning false leaves the event unprevented, which is what
  // lets the report page scroll normally.
  function filt(event) {
    if (!event) return false;
    if (event.type === 'wheel') {
      if (!coop || event.ctrlKey || event.metaKey) return true;
      showHint();
      return false;
    }
    if (event.touches) {
      if (!coop) return true;
      if (event.touches.length < 2) { showHint(); return false; }
      return true;
    }
    if (event.type === 'dblclick') return true;
    return !event.button;                       // primary-button drag pans
  }

  // SELF-HEALING ADOPTION - the "wired it, but it does not work" case. A generation can
  // call this helper and then draw the map straight onto the SVG anyway, which leaves the
  // layer empty and makes the zoom a silent no-op. So on the FIRST gesture, if the layer is
  // still empty, adopt the groups that actually hold the map: anything carrying a .d3-mark
  // or a basemap <path>, minus legend furniture, which must never move with the map. Same
  // doctrine as the exec gate healing a throw rather than failing the render.
  //
  // On first interaction rather than a timer: synchronous, nothing to schedule, and the
  // render is guaranteed complete because nobody can gesture at a chart that does not exist.
  var adopted = false, adoptedBaseR = null;
  function adopt() {
    if (adopted) return;
    adopted = true;
    try {
      var layerNode = layer.node(), svgNode = svg.node();
      if (!layerNode || !svgNode) return;
      if (layerNode.childNodes.length) return;          // drawn correctly - nothing to do
      var kids = [].slice.call(svgNode.childNodes), moved = 0;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType !== 1 || !n.querySelector) continue;
        if (n === viewport.node() || n === hint.node()) continue;
        if (ctrl && n === ctrl.node()) continue;
        if (pad && n === pad.node()) continue;
        if (n.tagName === 'defs' || n.tagName === 'title') continue;
        // Furniture stays put, even when it happens to contain a path.
        var isFurniture = (n.classList && n.classList.contains('d3-legend-mark'))
          || n.querySelector('.d3-legend-mark');
        if (isFurniture) continue;
        var holdsMap = n.tagName === 'path'
          || (n.classList && n.classList.contains('d3-mark'))
          || n.querySelector('.d3-mark')
          || (n.tagName === 'g' && n.querySelector('path'));
        if (!holdsMap) continue;
        layerNode.appendChild(n);                        // document order is preserved
        moved++;
      }
      if (!moved) return;
      // The chart's own onZoom cannot be counter-scaling marks it never put here, so the
      // helper takes that over: a radius encodes a MEASURE, not an area on the ground.
      adoptedBaseR = [];
      var ms = layerNode.querySelectorAll('.d3-mark');
      for (var j = 0; j < ms.length; j++) {
        var r = parseFloat(ms[j].getAttribute('r'));
        if (isFinite(r)) adoptedBaseR.push([ms[j], r, parseFloat(ms[j].getAttribute('stroke-width')) || 0]);
      }
    } catch (e) { /* a heal is never worth breaking the chart for */ }
  }

  // Base font sizes, captured lazily the first time we compensate - reading them every
  // frame would re-read a value we had already divided.
  var textBase = null;
  function scaleLayerText(k) {
    if (!(k > 0)) return;
    try {
      var layerNode = layer.node();
      if (!layerNode) return;
      var ts = layerNode.querySelectorAll('text');
      if (textBase === null || textBase.length !== ts.length) {
        textBase = [];
        for (var i = 0; i < ts.length; i++) {
          var cs = null;
          try { cs = window.getComputedStyle(ts[i]).fontSize; } catch (e) { cs = null; }
          var px = parseFloat(ts[i].getAttribute('font-size'));
          if (!isFinite(px)) px = parseFloat(cs);
          textBase.push(isFinite(px) && px > 0 ? px : 0);
        }
      }
      for (var j = 0; j < ts.length; j++) {
        if (textBase[j] > 0) ts[j].setAttribute('font-size', (textBase[j] / k).toFixed(2));
      }
    } catch (e) { /* a label size is never worth breaking the chart for */ }
  }

  function scaleAdopted(k) {
    if (!adoptedBaseR || !(k > 0)) return;
    for (var i = 0; i < adoptedBaseR.length; i++) {
      var e = adoptedBaseR[i];
      e[0].setAttribute('r', e[1] / k);
      if (e[2]) e[0].setAttribute('stroke-width', e[2] / k);
    }
  }

  var zoom = d3.zoom()
    // d3's DEFAULT wheelDelta multiplies by 10 when ctrlKey is set, because it assumes
    // ctrl+wheel means a trackpad PINCH. Here ctrl is the deliberate zoom modifier, so that
    // boost makes a single notch slam to the maximum scale. Use the plain delta.
    .wheelDelta(function (event) {
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
    })
    .scaleExtent([1, maxScale])
    .extent([[0, 0], [w, h]])
    // Keep the fitted world inside the frame: at k=1 there is nothing to pan to, which is
    // also what keeps the map from drifting off its own reserved area.
    .translateExtent([[0, 0], [w, h]])
    .clickDistance(4)
    .filter(filt)
    .on('zoom', function (event) {
      var t = event && event.transform ? event.transform : d3.zoomIdentity;
      adopt();                       // no-op when the chart drew into the layer as intended
      layer.attr('transform', t.toString());
      scaleAdopted(t.k);
      scaleLayerText(t.k);
      if (onZoom) { try { onZoom(t); } catch (e) { /* never break the render */ } }
      try {
        // The pad is always visible; only the arrows and Reset go live once there is
        // something to pan or undo. Hiding the whole cluster is what made zoom
        // undiscoverable in the first place.
        if (ctrl) ctrl.style('opacity', t.k > 1.001 ? 1 : 0.35);
        for (var pi = 0; pi < panBtns.length; pi++) panBtns[pi].style('opacity', t.k > 1.001 ? 1 : 0.35);
        if (pad) pad.raise();
      } catch (e) { /* ignore */ }
    });

  try { viewport.call(zoom); } catch (e) { if (pad) pad.remove(); return { layer: layer, reset: function () {}, step: function () {} }; }

  function reset() {
    try { viewport.call(zoom.transform, d3.zoomIdentity); } catch (e) { /* ignore */ }
  }

  // Pan by a FRACTION OF THE FRAME so a press feels the same on any tile size, divided by
  // k because translateBy works in the layer's own pre-scale coordinates - without that,
  // one press at k=8 would jump eight times as far as the same press at k=1. translateExtent
  // already clamps at the edges, so a press at the border is a no-op, never a drift off the
  // reserved map area. An arrow moves the VIEW that way, so the content moves the opposite
  // way - the same direction sense as a scrollbar or an arrow key.
  function llmZoomStep(dir) {
    try {
      if (dir === 'reset') { reset(); return; }
      if (dir === 'in') { viewport.call(zoom.scaleBy, 1.6); return; }
      if (dir === 'out') { viewport.call(zoom.scaleBy, 1 / 1.6); return; }
      var t = d3.zoomTransform(viewport.node());
      var k = t && t.k > 0 ? t.k : 1;
      var dx = (w * 0.18) / k, dy = (h * 0.18) / k;
      if (dir === 'left') viewport.call(zoom.translateBy, dx, 0);
      else if (dir === 'right') viewport.call(zoom.translateBy, -dx, 0);
      else if (dir === 'up') viewport.call(zoom.translateBy, 0, dy);
      else if (dir === 'down') viewport.call(zoom.translateBy, 0, -dy);
    } catch (e) { /* a control is never worth breaking the chart for */ }
  }

  return { layer: layer, reset: reset, zoom: zoom, viewport: viewport, pad: pad, step: llmZoomStep };
};
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
  const TYPE_FLOOR = 10;
  container.replaceChildren();
  const { columns, rows } = data;
  const W = options.width, H = options.height;
  const CF = Math.max(TYPE_FLOOR, Math.min(14, Math.round(Math.min(W, H) / 55)));
  const SMALL_FS = Math.max(TYPE_FLOOR, CF - 2);
  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`);
  const themeFg = options.themeFg || 'currentColor';
  const fmt = new Intl.NumberFormat(options.cultureCode, { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat(options.cultureCode, { maximumFractionDigits: 1 });

  const emptyMsg = (options && typeof options.noDataText === 'string' && options.noDataText) ? options.noDataText : 'No data to display';

  const ci = n => columns.findIndex(c => c.name === n);
  const stateIdx = ci('State');
  const isoIdx = ci('__geoIso__');
  const rowIdxIdx = ci('__rowIdx__');
  const revIdx = ci('Revenue');
  const regionIdx = ci('Region');
  const ordersIdx = ci('Orders');
  const rrIdx = ci('ReturnRate');

  if (stateIdx === -1) throw new Error('INVALID:column "State" not found');
  if (revIdx === -1) throw new Error('INVALID:column "Revenue" not found');
  if (isoIdx === -1) throw new Error('INVALID:column "__geoIso__" not found');

  if (!rows.length) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', themeFg).text(emptyMsg);
    return;
  }

  const V = d3.llmValueColumn(columns, rows, { prefer: revIdx, countLabel: 'Rows' });

  const byIso = new Map();
  let unmatchedCount = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const iso = row[isoIdx];
    if (iso == null || iso === '') { unmatchedCount++; continue; }
    let g = byIso.get(iso);
    if (!g) {
      g = { iso, label: row[stateIdx], revVals: [], regionCounts: new Map(), orderVals: [], rrVals: [], idx: [] };
      byIso.set(iso, g);
    }
    const rv = V.valueOf(row);
    if (rv != null) g.revVals.push(rv);
    if (regionIdx !== -1 && row[regionIdx] != null) {
      const rname = row[regionIdx];
      g.regionCounts.set(rname, (g.regionCounts.get(rname) || 0) + 1);
    }
    if (ordersIdx !== -1 && row[ordersIdx] != null && isFinite(+row[ordersIdx])) g.orderVals.push(+row[ordersIdx]);
    if (rrIdx !== -1 && row[rrIdx] != null && isFinite(+row[rrIdx])) g.rrVals.push(+row[rrIdx]);
    g.idx.push(rowIdxIdx !== -1 ? row[rowIdxIdx] : r);
  }

  const geo = options.geo;
  if (!geo || !geo.features || byIso.size === 0) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', themeFg).text(emptyMsg);
    return;
  }

  const aggMode = (options.aggregation || '').toLowerCase();
  const __agg = (a) => {
    if (!a.length) return null;
    if (aggMode === 'average') return d3.mean(a);
    if (aggMode === 'median') return d3.median(a);
    if (aggMode === 'min') return d3.min(a);
    if (aggMode === 'max') return d3.max(a);
    if (aggMode === 'count') return a.length;
    if (aggMode === 'distinct') return new Set(a).size;
    return d3.sum(a);
  };
  const aggWord = aggMode === 'average' ? 'Average' : aggMode === 'median' ? 'Median' : aggMode === 'min' ? 'Min' : aggMode === 'max' ? 'Max' : aggMode === 'count' ? 'Count of' : aggMode === 'distinct' ? 'Distinct' : 'Total';

  byIso.forEach(g => {
    g.value = g.revVals.length ? __agg(g.revVals) : null;
    g.revenueSum = g.revVals.length ? d3.sum(g.revVals) : null;
    g.revenueMean = g.revVals.length ? d3.mean(g.revVals) : null;
    g.orderSum = g.orderVals.length ? d3.sum(g.orderVals) : null;
    g.rrMean = g.rrVals.length ? d3.mean(g.rrVals) : null;
    g.rowCount = g.idx.length;
    // Region can genuinely vary within a state's rows: never collapse it to a
    // fabricated 'Mixed' placeholder. Show the dominant region honestly with its
    // share of the rows, or the single region name when there is only one.
    if (g.regionCounts.size === 0) {
      g.regionLabel = null;
    } else if (g.regionCounts.size === 1) {
      g.regionLabel = [...g.regionCounts.keys()][0];
    } else {
      let total = 0, bestName = null, bestCount = -1;
      g.regionCounts.forEach((cnt, name) => { total += cnt; if (cnt > bestCount) { bestCount = cnt; bestName = name; } });
      g.regionLabel = bestName + ' (' + bestCount + ' of ' + total + ')';
    }
  });

  const titleH = 22;
  const LEGX = 8, LEGY = titleH + 16, LEGH = 10, LEGW = 130;
  const legendBand = LEGY + LEGH + 16 + LEGH + 6;

  const fitCol = { type: 'FeatureCollection', features: geo.features };
  const proj = d3.geoAlbersUsa().fitExtent([[6, legendBand], [W - 6, H - 14]], fitCol);
  const path = d3.geoPath(proj);

  const vals = [];
  byIso.forEach(g => { if (g.value != null) vals.push(g.value); });
  const primary = '#08306b';
  const scaleLo = options.colorScaleLow || options.colorScaleAutoLow || '#f7fbff';
  const scaleHi = options.colorScaleHigh || options.colorScaleAutoHigh || primary;
  const ramp = d3.llmValueRamp({ values: vals, low: scaleLo, high: scaleHi });
  const color = ramp.color;

  const land = options.geoLandColor || '#e6e6e6';
  const noData = options.geoNoDataColor || land;

  const cxy = (c, i) => (c && isFinite(c[i]) ? Math.round(c[i] * 10) / 10 : null);

  const zTop = legendBand - 4;
  const z = (typeof d3.llmGeoZoom === 'function')
    ? d3.llmGeoZoom(svg, {
        width: W, height: Math.max(1, H - zTop), originX: 0, originY: zTop,
        themeFg: themeFg, backgroundColor: options.backgroundColor,
        fontSize: CF, maxScale: 8, onZoom: t => applyZoomScale(t.k)
      })
    : null;
  const mapLayer = z ? z.layer : svg;

  let zoomMapG = null;
  function applyZoomScale(k) {
    if (!(k > 0) || !zoomMapG) return;
    zoomMapG.selectAll('path').attr('stroke-width', 0.5 / k);
  }

  const gMap = mapLayer.append('g');
  zoomMapG = gMap;

  const tip = (options.allowTooltips !== false) ? d3.llmTooltip(container) : null;

  const statePaths = gMap.selectAll('path').data(geo.features, f => f.id).join('path')
    .attr('d', path)
    .attr('class', f => byIso.has(f.id) ? 'd3-mark' : null)
    .style('cursor', f => byIso.has(f.id) ? 'pointer' : null)
    .attr('data-row-idx', f => byIso.has(f.id) ? byIso.get(f.id).idx.join(',') : null)
    .attr('data-cx', f => byIso.has(f.id) ? cxy(path.centroid(f), 0) : null)
    .attr('data-cy', f => byIso.has(f.id) ? cxy(path.centroid(f), 1) : null)
    .attr('fill', f => { const g = byIso.get(f.id); return !g ? land : (g.value == null ? noData : color(g.value)); })
    .attr('stroke', '#fff').attr('stroke-width', 0.5);

  if (tip) {
    statePaths.filter(f => byIso.has(f.id))
      .on('mousemove', (event, f) => {
        const g = byIso.get(f.id);
        let html = '<b>' + g.label + '</b>';
        if (g.regionLabel) html += '<br/>Region: ' + g.regionLabel;
        if (g.value == null) {
          html += '<br/>' + V.valueName + ': no data';
        } else if (g.rowCount > 1) {
          html += '<br/>' + V.valueName + ': Total ' + fmt.format(g.revenueSum) + ' · Avg ' + fmt.format(g.revenueMean) + ' · ' + g.rowCount + ' rows';
        } else {
          html += '<br/>' + V.valueName + ': ' + fmt.format(g.revenueSum);
        }
        if (g.orderSum != null) html += '<br/>Orders: ' + fmt.format(g.orderSum);
        if (g.rrMean != null) html += '<br/>ReturnRate: ' + fmt1.format(g.rrMean) + '%';
        tip.show(html, event);
      })
      .on('mouseleave', () => tip.hide());
  } else {
    statePaths.filter(f => byIso.has(f.id)).append('title')
      .text(f => {
        const g = byIso.get(f.id);
        let t = g.label;
        if (g.regionLabel) t += ' - ' + g.regionLabel;
        t += ' - ' + V.valueName + ': ' + (g.value == null ? 'no data' : fmt.format(g.revenueSum));
        if (g.orderSum != null) t += ' - Orders: ' + fmt.format(g.orderSum);
        if (g.rrMean != null) t += ' - ReturnRate: ' + fmt1.format(g.rrMean) + '%';
        return t;
      });
  }

  const unm = (options.geoUnmatched && typeof options.geoUnmatched.count === 'number') ? options.geoUnmatched.count : unmatchedCount;
  if (unm > 0) {
    const unmText = unm + (unm === 1 ? ' region unmatched' : ' regions unmatched');
    const unmG = svg.append('g').attr('class', 'lch-caption');
    const unmT = unmG.append('text').attr('x', 8).attr('y', H - 8).attr('font-size', CF).attr('fill', themeFg);
    d3.llmFitLabel(unmT, W - 16, { pad: 0, text: unmText });
    if (unmT.text() !== unmText) unmG.insert('title', ':first-child').text(unmText);
  }

  svg.append('text').attr('class', 'chart-title').attr('text-anchor', 'start').attr('x', 8).attr('y', 16)
    .attr('font-size', Math.max(TYPE_FLOOR, 14)).attr('font-weight', 600).attr('fill', themeFg)
    .text('Revenue by State');

  const lw = LEGW, lh = LEGH, gid = 'llmgeo-' + Math.abs((W * 131 + H) | 0);
  ramp.drawLegend(svg, {
    x: LEGX, y: LEGY, width: lw, height: lh, labelY: lh + 10, fontSize: SMALL_FS,
    fg: themeFg, format: v => fmt.format(v), id: gid, stroke: themeFg
  });
  const L = svg.append('g').attr('transform', 'translate(' + LEGX + ',' + LEGY + ')');
  L.append('text').attr('y', -6).attr('font-size', SMALL_FS).attr('fill', themeFg).attr('fill-opacity', 0.85)
    .text(V.isCount ? (aggWord + ' ' + V.valueName + ' (count of rows)') : (aggWord + ' ' + V.valueName));

  let ndCount = 0; byIso.forEach(g => { if (g.value == null) ndCount++; });
  if (ndCount > 0 && noData !== land) {
    const S = L.append('g').attr('transform', 'translate(0,' + (lh + 16) + ')');
    S.append('rect').attr('width', lh).attr('height', lh).attr('fill', noData).attr('stroke', themeFg).attr('stroke-width', 0.5);
    S.append('text').attr('x', lh + 4).attr('y', lh - 1).attr('font-size', SMALL_FS).attr('fill', themeFg).text('no data');
  }
}
