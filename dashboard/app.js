// Token Radar — dark sweep dashboard. Renders window.RADAR only.
// No network, no fetch: every figure comes from data.js. Model radar-3:
// raw implied = TVL x peer multiple x growth x maturity x chain factor,
// then a risk discount of 0.5% per risk point gives the risk-adjusted
// value the board ranks by. The page recomputes each row with impliedOf(),
// riskScoreOf() and riskAdjustedOf() and checks them against the board.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var board = document.getElementById('board');
  if (!DATA || !board) return;

  var rows = Array.isArray(DATA.rows) ? DATA.rows : [];
  var live = Array.isArray(DATA.live) ? DATA.live : [];
  var cats = Array.isArray(DATA.categories) ? DATA.categories : [];
  var model = DATA.model || {};
  var VERSION = DATA.model_version || 'radar-3';

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, top50: false };
  var picked = {}; // slug -> true, the portfolio builder's selection

  /* ---------- small helpers ---------- */
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function catOf(r) { return r.category || 'Uncategorised'; }
  function chainsOf(r) { return Array.isArray(r.chains) ? r.chains : []; }
  function fmtUsd(n) {
    if (num(n) === null) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (num(n) === null) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (num(d) === null) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function fmtMult(v) {
    if (num(v) === null) return 'n/a';
    return 'x' + v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  /* ---------- the model, recomputed in the page ---------- */
  // Growth: 7d TVL change clamped to [growth_floor, growth_cap], then
  // weighted: 1 + clamped% / 100 * growth_weight. Missing change = 0.
  function growthFromModel(row) {
    if (num(row.growth_multiplier) !== null) return row.growth_multiplier;
    if (num(model.growth_weight) === null) return null;
    var g = num(row.change_7d) === null ? 0 : row.change_7d;
    var lo = num(model.growth_floor), hi = num(model.growth_cap);
    if (lo !== null) g = Math.max(lo, g);
    if (hi !== null) g = Math.min(hi, g);
    return 1 + (g / 100) * model.growth_weight;
  }
  // Maturity: floor + (age capped at maturity_days) / maturity_days * range.
  // Unknown age uses unknown_age_days.
  function maturityFromModel(row) {
    if (num(row.maturity_multiplier) !== null) return row.maturity_multiplier;
    if (num(model.maturity_floor) === null || num(model.maturity_range) === null || num(model.maturity_days) === null) return null;
    var age = num(row.age_days) === null ? (num(model.unknown_age_days) === null ? 365 : model.unknown_age_days) : row.age_days;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  // Chain factor: 1 + chain_step per extra chain, extra capped by
  // chain_max_extra steps (so at most 1 + 4 x 0.05 = 1.20).
  function chainFromModel(row) {
    if (num(row.chain_factor) !== null) return row.chain_factor;
    if (num(model.chain_step) === null || num(model.chain_max_extra) === null) return null;
    var extra = Math.min(Math.max(chainsOf(row).length - 1, 0), model.chain_max_extra);
    return 1 + extra * model.chain_step;
  }
  function factorsOf(row) {
    return {
      peer: num(row.peer_multiple) !== null ? row.peer_multiple : null,
      growth: growthFromModel(row),
      maturity: maturityFromModel(row),
      chain: chainFromModel(row)
    };
  }
  // Raw implied value, before the risk discount.
  function impliedOf(row) {
    var f = factorsOf(row);
    if (f.peer === null || f.growth === null || f.maturity === null || f.chain === null) return null;
    if (num(row.tvl_usd) === null) return null;
    return Math.max(1, Math.round(row.tvl_usd * f.peer * f.growth * f.maturity * f.chain));
  }
  // Risk score: the six components summed, capped at 100.
  function riskScoreOf(row) {
    var p = row.risk_parts;
    if (!p) return num(row.risk_score);
    var sum = 0, keys = ['concentration', 'age', 'growth', 'size', 'peers', 'execution'];
    keys.forEach(function (k) { if (num(p[k]) !== null) sum += p[k]; });
    return Math.min(100, sum);
  }
  function riskTierOf(score) {
    if (num(score) === null) return 'n/a';
    if (score < 25) return 'Low';
    if (score < 50) return 'Moderate';
    if (score < 70) return 'High';
    return 'Very high';
  }
  // Risk-adjusted value: raw x (1 - score x discount per point).
  function riskAdjustedOf(row) {
    var raw = impliedOf(row), score = riskScoreOf(row);
    if (raw === null || score === null || num(model.risk_discount_per_point) === null) return null;
    return Math.max(1, Math.round(raw * (1 - score * model.risk_discount_per_point)));
  }
  // Execution risk, from the category's own wording only — never the name.
  function executionRiskLabel(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('option') >= 0 || c.indexOf('prediction') >= 0) return 'MEV and slippage on entry';
    if (c.indexOf('bridge') >= 0) return 'Bridge and counterparty risk';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Liquidation risk';
    if (c.indexOf('restak') >= 0) return 'Slashing and curator risk';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0) return 'Peg and issuer risk';
    return 'Execution risk on entry';
  }
  function executionRiskNote(label) {
    if (label.indexOf('MEV') === 0) return 'Swaps and perps here pay MEV and slippage on entry and exit: keep the trade small and check the quoted price before you confirm.';
    if (label.indexOf('Bridge') === 0) return 'Bridged funds sit with the bridge until they land: verify the official bridge address and never bridge more than you can afford to have delayed.';
    if (label.indexOf('Liquidation') === 0) return 'A borrowed position can be liquidated if the collateral falls: keep the health factor high and the borrowed amount small.';
    if (label.indexOf('Slashing') === 0) return 'Restaked receipts depend on the curator and its operators: a slashing event or a curator failure reaches the receipt token.';
    if (label.indexOf('Peg') === 0) return 'A stable or real-world asset holds its value only while its backing and issuer do: check the backing and redemption terms first.';
    return 'Every farm pays gas and a little slippage to enter: keep the first position small and confirm the transaction before you add more.';
  }
  // Live-token ratio for one live protocol: TVL / market cap.
  function liveRatioOf(l) {
    if (num(l.tvl_usd) === null || num(l.mcap_usd) === null || l.mcap_usd === 0) return null;
    return l.tvl_usd / l.mcap_usd;
  }

  /* ---------- portfolio builder ---------- */
  // Launch probabilities by readiness tier. Stated assumptions for the
  // builder, not snapshot facts: most pre-token protocols never launch.
  var LAUNCH_PROB = { Ready: 0.25, Watching: 0.12, Early: 0.05 };
  function launchProbOf(row) { return LAUNCH_PROB[row.readiness] || 0.05; }
  // Expected value: sum of risk-adjusted implied value x launch probability.
  function portfolioExpectedValue(list) {
    var total = 0;
    list.forEach(function (r) { if (num(r.implied_value_usd) !== null) total += r.implied_value_usd * launchProbOf(r); });
    return Math.round(total);
  }
  // Diversification: how many categories and chains the picks span, and
  // the largest single-category share of capital.
  function portfolioDiversification(list) {
    var catsSeen = {}, chainsSeen = {}, byCat = {}, capital = 0;
    list.forEach(function (r) {
      catsSeen[catOf(r)] = true;
      chainsOf(r).forEach(function (c) { chainsSeen[c] = true; });
      var cap = num(r.capital_usd) || 0;
      byCat[catOf(r)] = (byCat[catOf(r)] || 0) + cap;
      capital += cap;
    });
    var topShare = 0, topCat = null;
    Object.keys(byCat).forEach(function (c) {
      if (capital > 0 && byCat[c] / capital > topShare) { topShare = byCat[c] / capital; topCat = c; }
    });
    var note = list.length === 0 ? 'Nothing picked yet.'
      : topShare > 0.5 ? 'Concentrated: over half the capital sits in ' + topCat + ' — one category deciding the outcome.'
      : Object.keys(catsSeen).length < 3 ? 'Thin spread: fewer than 3 categories — one bad category hurts the whole portfolio.'
      : 'Spread across ' + Object.keys(catsSeen).length + ' categories and ' + Object.keys(chainsSeen).length + ' chains.';
    return { categories: Object.keys(catsSeen).length, chains: Object.keys(chainsSeen).length, note: note };
  }
  // Weekly farm time: minutes per week read off the farm steps' own
  // "Time: N minutes a week" lines, summed across the picks.
  function weeklyMinutesOf(row) {
    var mins = 0;
    (Array.isArray(row.farm_steps) ? row.farm_steps : []).forEach(function (s) {
      var p = splitStep(s);
      if (p.time && /week/i.test(p.time)) {
        var m = p.time.match(/(\d+)\s*min/i);
        if (m) mins += parseInt(m[1], 10);
      }
    });
    return mins;
  }
  // The whole portfolio score, from the picked rows only.
  function portfolioScore(list) {
    var capital = 0, weightedRisk = 0, weekly = 0;
    list.forEach(function (r) {
      var cap = num(r.capital_usd) || 0;
      capital += cap;
      weightedRisk += cap * (num(r.risk_score) || 0);
      weekly += weeklyMinutesOf(r);
    });
    return {
      count: list.length,
      capital: capital,
      expectedValue: portfolioExpectedValue(list),
      blendedRisk: capital > 0 ? weightedRisk / capital : null,
      weeklyMinutes: weekly,
      diversification: portfolioDiversification(list)
    };
  }
  function pickedRows() { return rows.filter(function (r) { return picked[r.slug]; }); }
  function fillTop10() {
    picked = {};
    rows.slice().sort(function (a, b) { return (num(b.implied_value_usd) || 0) - (num(a.implied_value_usd) || 0); })
      .slice(0, 10).forEach(function (r) { picked[r.slug] = true; });
  }

  /* ---------- farm plan: the board's own steps, shown verbatim ---------- */
  // A step is "<action> Cost: <cost>. Time: <time>." Split only for display;
  // the words are the board's, never recomputed here.
  function splitStep(s) {
    var str = String(s || '');
    var ci = str.indexOf(' Cost: ');
    if (ci < 0) return { action: str, cost: null, time: null };
    var ti = str.indexOf(' Time: ', ci + 7);
    if (ti < 0) return { action: str.slice(0, ci), cost: str.slice(ci + 7).replace(/\.+$/, ''), time: null };
    return { action: str.slice(0, ci), cost: str.slice(ci + 7, ti).replace(/\.+$/, ''), time: str.slice(ti + 7).replace(/\.+$/, '') };
  }

  /* ---------- hash state ---------- */
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var ps = new URLSearchParams(h);
    if (ps.get('q')) state.q = ps.get('q');
    if (ps.get('category')) state.category = ps.get('category');
    if (ps.get('chain')) state.chain = ps.get('chain');
    if (ps.get('tab') === 'live' || ps.get('tab') === 'pre-token') state.tab = ps.get('tab');
    if (ps.get('top50') === '1') state.top50 = true;
    if (ps.get('p')) state.selected = ps.get('p');
  }
  function writeHash() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.category !== 'all') ps.set('category', state.category);
    if (state.chain !== 'all') ps.set('chain', state.chain);
    if (state.tab !== 'pre-token') ps.set('tab', state.tab);
    if (state.top50) ps.set('top50', '1');
    if (state.selected) ps.set('p', state.selected);
    var next = ps.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  /* ---------- filtering + sorting ---------- */
  function matches(r) {
    if (state.category !== 'all' && catOf(r) !== state.category) return false;
    if (state.chain !== 'all' && chainsOf(r).indexOf(state.chain) < 0) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    return [r.name, r.slug, catOf(r), chainsOf(r).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function filteredRows() {
    var list = rows.filter(matches);
    if (state.top50) list = list.filter(function (r) { return num(r.rank) !== null && r.rank <= 50; });
    return list;
  }
  function filteredLive() { return live.filter(matches); }
  function sortVal(r, key) {
    if (key === 'name') return (r.name || '').toLowerCase();
    if (key === 'tvl') return num(r.tvl_usd) === null ? -1 : r.tvl_usd;
    if (key === 'growth') return num(r.change_7d) === null ? -Infinity : r.change_7d;
    if (key === 'age') return num(r.age_days) === null ? Infinity : r.age_days;
    if (key === 'risk') return num(r.risk_score) === null ? -1 : r.risk_score;
    return num(r.implied_value_usd) === null ? -1 : r.implied_value_usd;
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (key === 'implied' || key === 'rank') return (a.rank || 0) - (b.rank || 0);
      return (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  /* ---------- sections ---------- */
  function header() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'brand' },
        el('span', { class: 'rings', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' })),
          el('span', { class: 'brand-sub', text: 'Pre-token protocol sweep' })
        )
      ),
      el('div', { class: 'meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of || 'n/a' })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: VERSION }))
      )
    );
  }
  function lede() {
    var watch = num(DATA.watchlist_size) === null ? rows.length : DATA.watchlist_size;
    return el('section', { class: 'lede' },
      el('div', null,
        el('p', { class: 'kicker', text: 'Radar sweep · ' + (DATA.as_of || '') }),
        el('h1', { text: watch + ' watchlist protocols, ranked by implied value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: fmtUsd(DATA.floor_usd) }), ' of TVL that records no token. The early radar adds ', el('b', { text: String(num(DATA.early_size) === null ? 0 : DATA.early_size) + ' pre-token protocols' }), ' below that floor. Implied value models what a token would be worth if the record stayed as it is — not a promise, not a prediction of a launch.')
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, String(watch), ' / ', String(watch))),
        el('div', { class: 'stat hot' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(num(DATA.board_size) === null ? rows.length : DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(num(DATA.early_size) === null ? 0 : DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(num(DATA.live_size) === null ? live.length : DATA.live_size) }))
      )
    );
  }
  function optionList(values, current, allLabel) {
    var opts = [el('option', { value: 'all', text: allLabel })];
    values.forEach(function (v) { opts.push(el('option', { value: v, text: v, selected: v === current ? 'selected' : null })); });
    return opts;
  }
  function controls(shownCount) {
    var catsList = [], chs = [];
    rows.concat(live).forEach(function (r) {
      if (catsList.indexOf(catOf(r)) < 0) catsList.push(catOf(r));
      chainsOf(r).forEach(function (c) { if (chs.indexOf(c) < 0) chs.push(c); });
    });
    catsList.sort(); chs.sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' }, optionList(catsList, state.category, 'All categories'));
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionList(chs, state.chain, 'All chains'));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label,
        onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var top50Btn = el('button', { type: 'button', class: 'btn top50', 'aria-pressed': state.top50 ? 'true' : 'false', text: 'Top 50',
      onclick: function () { state.top50 = !state.top50; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'seg' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'))),
      top50Btn,
      el('span', { class: 'shown' }, el('b', { text: String(shownCount) }), ' rows shown')
    );
  }
  function sortTh(key, label) {
    var arrow = state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }) : null;
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } }, label, arrow));
  }
  function growthCell(r) {
    var v = num(r.change_7d);
    return el('td', { class: 'num ' + (v === null ? 'flat' : v >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
  }
  function protoCell(r) {
    return el('td', { class: 'proto' }, el('b', { text: r.name }), el('span', { text: catOf(r) + ' · ' + (chainsOf(r).slice(0, 3).join(', ') || 'chain not listed') }));
  }
  function riskCell(r) {
    var score = num(r.risk_score), tier = r.risk_tier || riskTierOf(score);
    var cls = tier === 'Low' ? 'low' : tier === 'Moderate' ? 'mod' : tier === 'High' ? 'high' : 'vhigh';
    return el('td', { class: 'num' }, el('span', { class: 'risk-score', text: score === null ? 'n/a' : String(score) }), ' ', el('span', { class: 'tier ' + cls, text: tier }));
  }
  function readinessPill(r) {
    var cls = r.readiness === 'Ready' ? 'ready' : r.readiness === 'Watching' ? 'watching' : 'early';
    return el('span', { class: 'ready ' + cls, text: r.readiness || 'n/a' });
  }
  function emptyState() {
    return el('div', { class: 'board' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Nothing on the board fits this search, category or chain. Clear the filters to see the full radar again.' }),      el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.top50 = false; writeHash(); render(); } })
    ));
  }

  /* ---------- portfolio panel (above the board) ---------- */
  function portfolioPanel() {
    var score = portfolioScore(pickedRows());
    var div = portfolioDiversification(pickedRows());
    var riskText = score.blendedRisk === null ? 'n/a' : score.blendedRisk.toFixed(1) + ' / 100';
    var summary = el('summary', null,
      el('span', { class: 'pf-title', text: 'Portfolio builder' }),
      el('span', { class: 'pf-sum' }, el('b', { text: String(score.count) }), ' picked · ',
        el('b', { text: fmtUsd(score.capital) }), ' capital · ',
        el('b', { text: fmtUsd(score.expectedValue) }), ' expected value')
    );
    var body = el('div', { class: 'pf-body' },
      el('div', { class: 'pf-stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Selected' }), el('b', { text: String(score.count) })),
        el('div', { class: 'stat' }, el('span', { text: 'Total capital' }), el('b', { text: fmtUsd(score.capital) })),
        el('div', { class: 'stat hot' }, el('span', { text: 'Expected value' }), el('b', { text: fmtUsd(score.expectedValue) })),
        el('div', { class: 'stat' }, el('span', { text: 'Blended risk (capital-weighted)' }), el('b', { text: riskText })),
        el('div', { class: 'stat' }, el('span', { text: 'Diversification' }), el('b', { text: div.categories + ' categories · ' + div.chains + ' chains' })),
        el('div', { class: 'stat' }, el('span', { text: 'Weekly farm time' }), el('b', { text: score.weeklyMinutes + ' min / week' }))
      ),
      el('p', { class: 'pf-note' }, div.note),
      el('p', { class: 'pf-note' }, 'Expected value uses stated launch assumptions, not snapshot facts: Ready 25%, Watching 12%, Early 5% — a rough upside case, not a return.'),
      el('div', { class: 'pf-actions' },
        el('button', { class: 'btn primary', type: 'button', text: 'Fill with top 10', onclick: function () { fillTop10(); render(); } }),
        el('button', { class: 'btn', type: 'button', text: 'Clear', onclick: function () { picked = {}; render(); } })
      ),
      pickedRows().length ? el('ul', { class: 'pf-list' }, pickedRows().map(function (r) {
        return el('li', null,
          el('button', { type: 'button', class: 'pf-x', 'aria-label': 'Remove ' + r.name, text: '\u00D7', onclick: function (e) { e.stopPropagation(); delete picked[r.slug]; render(); } }),
          el('b', { text: r.name }), ' ',
          el('span', { text: '#' + r.rank + ' · ' + catOf(r) + ' · ' + fmtUsd(r.capital_usd) + ' · ' + fmtUsd(r.implied_value_usd) })
        );
      })) : el('p', { class: 'pf-empty', text: 'Tick a board row to add it, or fill with the top 10 by implied value.' })
    );
    return el('details', { class: 'portfolio', open: '' }, summary, body);
  }

  /* ---------- board table ---------- */
  function boardTable() {
    var list = sorted(filteredRows());
    if (!list.length) return emptyState();
    var max = Math.max.apply(null, list.map(function (r) { return num(r.implied_value_usd) || 0; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var pct = max ? Math.max(3, Math.round((num(r.implied_value_usd) || 0) / max * 100)) : 3;
      var box = el('input', { type: 'checkbox', 'aria-label': 'Add ' + r.name + ' to portfolio', checked: picked[r.slug] ? 'checked' : null });
      box.addEventListener('click', function (e) { e.stopPropagation(); });
      box.addEventListener('change', function () { if (box.checked) picked[r.slug] = true; else delete picked[r.slug]; render(); });
      var tr = el('tr', {
        'data-rank': String(r.rank), tabindex: '0', class: r.rank <= 3 ? 'top3' : null,
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'pick' }, box),
        el('td', { class: 'num', text: String(r.rank) }),
        protoCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        riskCell(r),
        el('td', { title: 'Raw implied value before the risk discount: ' + fmtUsd(r.implied_raw_usd) }, el('div', { class: 'value-cell' },
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, readinessPill(r)),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols, strongest risk-adjusted implied value first. Tick a row for the portfolio; select one for its breakdown and farm plan.' }),        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Pick' }), sortTh('implied', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL'), sortTh('growth', '7d'), sortTh('age', 'Age'), sortTh('risk', 'Risk'), sortTh('implied', 'Implied value'), el('th', { scope: 'col', text: 'Readiness' }), el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }
  function liveTable() {
    var list = filteredLive().slice().sort(function (a, b) { return (num(b.mcap_usd) || 0) - (num(a.mcap_usd) || 0); });
    if (!list.length) return emptyState();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', null, el('span', { class: 'pill live', text: 'live' })),
        protoCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(liveRatioOf(r)) }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { text: 'Live-token protocols, largest market cap first — a market fact, not a model, so never scored by implied value.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'TVL / mcap' }), el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
  }

  /* ---------- live market panel: the pricing evidence ---------- */
  function liveMarketPanel() {
    var topCats = cats.slice().sort(function (a, b) { return (num(b.n) || 0) - (num(a.n) || 0); }).slice(0, 10);
    var catBody = el('tbody');
    topCats.forEach(function (c) {
      catBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'num', text: String(num(c.n) === null ? 0 : c.n) }),
        el('td', { class: 'num ' + (num(c.median_change_7d) === null ? 'flat' : c.median_change_7d >= 0 ? 'up' : 'down'), text: fmtPct(c.median_change_7d) }),
        el('td', { class: 'num', text: fmtUsd(c.median_tvl_usd) })
      ));
    });
    var topLive = live.slice().sort(function (a, b) { return (num(b.mcap_usd) || 0) - (num(a.mcap_usd) || 0); }).slice(0, 8);
    var liveBody = el('tbody');
    topLive.forEach(function (l) {
      liveBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: l.name }), el('span', { class: 'sub2', text: catOf(l) })),
        el('td', { class: 'num', text: fmtUsd(l.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(l.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(liveRatioOf(l)) })
      ));
    });
    return el('section', { class: 'live-panel' },
      el('h2', { text: 'Live market pricing — what the market already pays' }),
      el('p', null, 'The peer multiple is the median TVL / market cap of the live-token protocols in each category, from this same snapshot.'),
      el('div', { class: 'live-grid' },
        el('div', { class: 'board mini' }, el('div', { class: 'scroll' },
          el('table', null,
            el('caption', { text: 'Top categories by live peer count.' }),
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Peer multiple' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median 7d' }), el('th', { scope: 'col', text: 'Median TVL' })
            )),
            catBody
          )
        )),
        el('div', { class: 'board mini' }, el('div', { class: 'scroll' },
          el('table', null,
            el('caption', { text: 'Top live protocols by market cap.' }),
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'TVL / mcap' })
            )),
            liveBody
          )
        ))
      )
    );
  }

  function formulaText() {
    var parts = ['implied value = TVL'];
    parts.push('x peer multiple');
    parts.push('x growth multiplier');
    parts.push('x maturity multiplier');
    parts.push('x chain factor');
    var extra = [];
    if (num(model.growth_floor) !== null && num(model.growth_cap) !== null) extra.push('growth is clamped to ' + model.growth_floor + '% … ' + model.growth_cap + '%');
    if (num(model.maturity_days) !== null) extra.push('maturity reaches its full weight at ' + model.maturity_days + ' days');
    if (num(model.risk_discount_per_point) !== null) extra.push('then minus ' + (model.risk_discount_per_point * 100) + '% per risk point');
    return parts.join(' ') + (extra.length ? '  —  ' + extra.join('; ') : '');
  }
  function methodPanel() {
    return el('section', { class: 'method' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'One function scores every row, from the snapshot\u2019s own figures only. No protocol name is special-cased and no row is hand-picked. The page recomputes the raw value, the risk score and the risk-adjusted value for every row.' }),
      el('div', { class: 'formula', text: formulaText() }),
      el('ul', null,
        el('li', null, el('b', { text: 'Peer multiple. ' }), 'Median TVL / market cap of the live-token protocols in the same category. Each live ratio is winsorized to [0.05, 30], the median shrunk toward the global median by peer count (blend weight 8), and the multiple clamped to [0.5, 10].'),
        el('li', null, el('b', { text: 'Growth multiplier. ' }), 'Seven-day TVL change, clamped so one hot week cannot dominate, weighted into a multiplier near 1. A missing figure counts as no growth.'),
        el('li', null, el('b', { text: 'Maturity multiplier. ' }), 'How long the protocol has run since first listed with no token. Older listings score higher, up to a cap. An unlisted age uses a neutral middle value.'),
        el('li', null, el('b', { text: 'Chain factor. ' }), 'One plus 0.05 per chain beyond the first, capped at 4 extra steps (1.20 at most), so chain count alone never decides a rank.'),
        el('li', null, el('b', { text: 'Risk model. ' }), 'Six components from the snapshot only: single-chain concentration (1 chain 25 pts, 2 chains 12, 3 chains 6), short track record (under 180 days 20, under a year 10, under 3 years 5), shrinking TVL (down 20%+ in 7 days 15, 10%+ 10, any fall 5), small size (TVL under $100M 10), thin peer evidence (under 3 live peers 10, under 5 5), execution risk by category (DEX and derivatives MEV and slippage, bridges bridge risk, lending liquidation, restaking slashing). They sum to the score, capped at 100; tiers Low under 25, Moderate under 50, High under 70, Very high 70+.'),
        el('li', null, el('b', { text: 'Risk discount. ' }), 'The raw implied value is cut by 0.5% per risk point: adjusted = raw x (1 - score x 0.005). The board ranks by the adjusted value, so a risky protocol must earn its rank twice.'),
        el('li', null, el('b', { text: 'Momentum. ' }), 'Each row\u2019s 7-day change minus its category median: positive means outrunning its category this week. A missing figure leaves momentum blank.'),
        el('li', null, el('b', { text: 'Readiness. ' }), 'Ready: listed a year+, at/above the floor, not shrinking this week. Watching: 180 days+ and $100M TVL, or at the floor. The rest is Early. Readiness describes the record, not a launch signal.'),
        el('li', null, el('b', { text: 'Portfolio scoring. ' }), 'The builder sums picked capital, takes the capital-weighted mean risk score, and takes expected value as the sum of risk-adjusted implied value x launch probability — Ready 25%, Watching 12%, Early 5%, stated assumptions, not snapshot facts. Weekly time is read off the farm steps\u2019 per-week lines.')
      ),
      el('p', { text: "The board applies the house watchlist's own exclusion rule to every row: no wrapped, staked or bridged product of a token that already trades, no exchange product, and no versioned pool." }),
      el('p', { class: 'note' }, el('b', { text: 'What the model does not do: ' }), 'it does not predict whether or when a token will launch, uses no figure outside the snapshot, and never treats one protocol differently because of its name.')
    );
  }
  function footer() {
    return el('footer', { class: 'foot' },
      el('span', null, 'Snapshot ', el('b', { text: DATA.as_of || 'n/a' }), ' · DefiLlama protocol index · Model ', el('b', { text: VERSION })),
      el('span', { text: 'Implied values are model estimates from TVL, growth, age and peer multiples — not prices, not advice, not a prediction that any token will launch.' })
    );
  }

  /* ---------- detail dialog ---------- */
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { if (state.selected) { state.selected = null; writeHash(); } });
  function eqRow(label, value) {
    return el('div', { class: 'row' }, el('span', { text: label }), el('b', { text: value }));
  }
  function checkLine(ok, text) {
    return el('p', { class: 'check ' + (ok === null ? 'na' : ok ? 'ok' : 'warn'), text: text });
  }
  function openDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var f = factorsOf(row);
    var raw = impliedOf(row), adj = riskAdjustedOf(row), score = riskScoreOf(row);
    var discount = num(score) !== null && num(model.risk_discount_per_point) !== null ? score * model.risk_discount_per_point : null;
    // One recompute line covering both values: raw, then risk-adjusted.
    var rawBit = raw === null ? 'raw recompute unavailable (a model factor is missing)'
      : raw === row.implied_raw_usd ? 'raw ' + fmtUsd(raw) + ' matches' : 'raw ' + fmtUsd(raw) + ' does NOT match the board raw figure ' + fmtUsd(row.implied_raw_usd);
    var adjBit = adj === null ? 'adjusted recompute unavailable'
      : adj === row.implied_value_usd ? 'adjusted ' + fmtUsd(adj) + ' matches' : 'adjusted ' + fmtUsd(adj) + ' does NOT match the board figure ' + fmtUsd(row.implied_value_usd);
    var bothOk = raw !== null && raw === row.implied_raw_usd && adj !== null && adj === row.implied_value_usd;
    var eitherMissing = raw === null || adj === null;
    var recomputeCheck = checkLine(eitherMissing ? null : bothOk, 'Recompute: ' + rawBit + '; ' + adjBit + (bothOk ? '.' : ' — treat the board figure as stale until the data is rebuilt.'));
    var riskCheck = score === null ? checkLine(null, 'Risk recompute unavailable: the six components are missing for this row.')
      : score === row.risk_score ? checkLine(true, 'Risk recomputed ' + score + ' / 100 — matches the board figure.')
      : checkLine(false, 'Risk recomputed ' + score + ' / 100 — does NOT match the board figure ' + row.risk_score + '.');
    // Risk components, compact grid: each cell names the component, the
    // row's own evidence, and its points.
    var p = row.risk_parts || {};
    var compCells = [
      ['Concentration · ' + chainsOf(row).length + ' chain' + (chainsOf(row).length === 1 ? '' : 's'), num(p.concentration)],
      ['Track record · ' + fmtAge(row.age_days), num(p.age)],
      ['TVL trend · ' + fmtPct(row.change_7d), num(p.growth)],
      ['Size · ' + fmtUsd(row.tvl_usd), num(p.size)],
      ['Peer evidence · ' + (num(row.peer_n) === null ? 0 : row.peer_n) + ' peers', num(p.peers)],
      ['Execution · ' + executionRiskLabel(catOf(row)), num(p.execution)]
    ].map(function (c) {
      return el('div', { class: 'risk-cell' }, el('span', { text: c[0] }), el('b', { text: c[1] === null ? 'n/a' : String(c[1]) + ' pts' }));
    });
    var execLabel = executionRiskLabel(catOf(row));
    // Live comparables in the same category, largest market cap first.
    var peers = live.filter(function (l) { return catOf(l) === catOf(row); })
      .slice().sort(function (a, b) { return (num(b.mcap_usd) || 0) - (num(a.mcap_usd) || 0); }).slice(0, 3);
    var compBody = peers.length ? el('div', { class: 'equation' }, peers.map(function (l) {
      return el('div', { class: 'row' }, el('span', { text: l.name }), el('b', { text: fmtMult(liveRatioOf(l)) + ' · ' + fmtUsd(l.mcap_usd) }));
    })) : (num(row.peer_n) > 0 ? el('p', { class: 'check na', text: 'The ' + row.peer_n + ' live protocol' + (row.peer_n === 1 ? '' : 's') + ' that priced this category sit' + (row.peer_n === 1 ? 's' : '') + ' outside the top 24 by market cap shown in the Live view, so none is listed here — the multiple still comes from them, shrunk toward the global median.' })
      : el('p', { class: 'check na', text: 'No live-token protocol in this category priced the peer multiple — the multiple leans on the global median instead.' }));
    var catMed = null;
    cats.forEach(function (c) { if (c.category === catOf(row)) catMed = c; });
    var inner = el('div', { class: 'detail-inner' },
      el('div', { class: 'detail-top' },
        el('div', null,
          el('span', { class: 'rank-tag', text: 'Rank ' + row.rank + ' of ' + (num(DATA.board_size) === null ? rows.length : DATA.board_size) }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: catOf(row) + ' · ' + (chainsOf(row).slice(0, 3).join(', ') || 'chain not listed') + (chainsOf(row).length > 3 ? ' +' + (chainsOf(row).length - 3) + ' more' : '') + ' · listed ' + (row.listed_at || 'date unknown') })
        ),
        el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close details', text: '\u00D7', onclick: function () { dialog.close(); } })
      ),
      el('div', { class: 'key-stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Readiness' }), el('b', { text: (row.readiness || 'n/a') + ' · ' + Math.round(launchProbOf(row) * 100) + '%' })),
        el('div', { class: 'stat' }, el('span', { text: 'Momentum vs category' }), el('b', { text: num(row.momentum_pct) === null ? 'n/a' : fmtPct(row.momentum_pct) })),
        el('div', { class: 'stat' }, el('span', { text: 'Capital to farm' }), el('b', { text: fmtUsd(row.capital_usd) })),
        el('div', { class: 'stat' }, el('span', { text: 'Weekly farm time' }), el('b', { text: weeklyMinutesOf(row) + ' min / week' }))
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Implied value — the equation' }),
        el('div', { class: 'equation' },
          eqRow('TVL', fmtUsd(row.tvl_usd)),
          eqRow('Peer multiple (median TVL / market cap, live peers in this category)', fmtMult(f.peer)),
          eqRow('Growth multiplier (7d ' + fmtPct(row.change_7d) + ')', fmtMult(f.growth)),
          eqRow('Maturity multiplier (age ' + fmtAge(row.age_days) + ')', fmtMult(f.maturity)),
          eqRow('Chain factor (' + chainsOf(row).length + ' chain' + (chainsOf(row).length === 1 ? '' : 's') + ')', fmtMult(f.chain)),
          el('div', { class: 'row' }, el('span', { text: '= Raw implied value' }), el('b', { text: fmtUsd(row.implied_raw_usd) })),
          eqRow('Risk discount (' + (num(score) === null ? 'n/a' : score + ' pts') + ' x ' + (num(model.risk_discount_per_point) === null ? 'n/a' : (model.risk_discount_per_point * 100) + '%') + ' = ' + (discount === null ? 'n/a' : (discount * 100).toFixed(1) + '%') + ')', discount === null ? 'n/a' : '−' + (discount * 100).toFixed(1) + '%'),
          el('div', { class: 'row total' }, el('span', { text: '= Risk-adjusted implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
        ),
        recomputeCheck
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Risk — ' + (num(score) === null ? 'n/a' : score + ' / 100 · ' + (row.risk_tier || riskTierOf(score))) }),
        el('div', { class: 'risk-grid' }, compCells),
        el('p', { class: 'risk' }, el('b', { text: execLabel + '. ' }), executionRiskNote(execLabel)),
        riskCheck
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Live comparables — peer ' + (catMed ? fmtMult(catMed.multiple) + ' from ' + (num(catMed.n) === null ? 0 : catMed.n) + ' live peers' : 'no category pricing') }),
        compBody
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'farm' }, (Array.isArray(row.farm_steps) ? row.farm_steps : []).map(function (s) {
          var sp = splitStep(s);
          if (sp.cost === null) return el('li', null, el('b', { text: sp.action }));
          if (sp.time === null) return el('li', null, el('b', { text: sp.action }), ' ', el('span', { class: 'cost', text: 'Cost: ' + sp.cost }));
          return el('li', null, el('b', { text: sp.action }), ' ', el('span', { class: 'cost', text: 'Cost: ' + sp.cost + ' · Time: ' + sp.time }));
        }))
      ),
      el('p', { class: 'risk' }, el('b', { text: 'Risk note. ' }), 'This protocol records no token — an estimate, not a price, and not a prediction of a launch. Only farm with funds you can afford to leave locked, and verify every step on the protocol\u2019s own pages.')
    );
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  /* ---------- render ---------- */
  function render() {
    board.textContent = '';
    var wrap = el('div', { class: 'wrap' });
    var shown = state.tab === 'pre-token' ? filteredRows().length : filteredLive().length;
    wrap.appendChild(header());
    wrap.appendChild(lede());
    wrap.appendChild(controls(shown));
    if (state.tab === 'pre-token') {
      wrap.appendChild(boardTable());
      wrap.appendChild(portfolioPanel());
      wrap.appendChild(liveMarketPanel());
      wrap.appendChild(methodPanel());
    } else {
      wrap.appendChild(liveTable());
      wrap.appendChild(liveMarketPanel());
    }
    wrap.appendChild(footer());
    board.appendChild(wrap);
    board.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) board.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
