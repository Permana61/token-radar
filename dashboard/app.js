// Token Radar — dark sweep dashboard. Renders window.RADAR only.
// No network, no fetch: every figure on the page comes from data.js.
// The model is radar-2: implied value = TVL x peer multiple x growth
// multiplier x maturity multiplier x chain factor. The page recomputes
// each row with impliedOf() and checks it against the board figure.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var board = document.getElementById('board');
  if (!DATA || !board) return;

  var rows = Array.isArray(DATA.rows) ? DATA.rows : [];
  var live = Array.isArray(DATA.live) ? DATA.live : [];
  var model = DATA.model || {};
  var VERSION = DATA.model_version || 'radar-2';

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
  function growthFromModel(row) {
    if (num(row.growth_multiplier) !== null) return row.growth_multiplier;
    if (num(model.growth_weight) === null) return null;
    var g = num(row.change_7d) === null ? 0 : row.change_7d;
    var lo = num(model.growth_floor), hi = num(model.growth_cap);
    if (lo !== null) g = Math.max(lo, g);
    if (hi !== null) g = Math.min(hi, g);
    return 1 + (g / 100) * model.growth_weight;
  }
  function maturityFromModel(row) {
    if (num(row.maturity_multiplier) !== null) return row.maturity_multiplier;
    if (num(model.maturity_floor) === null || num(model.maturity_range) === null || num(model.maturity_days) === null) return null;
    var age = num(row.age_days) === null ? (num(model.unknown_age_days) === null ? 365 : model.unknown_age_days) : row.age_days;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  function factorsOf(row) {
    return {
      peer: num(row.peer_multiple) !== null ? row.peer_multiple : num(model.base_multiple),
      growth: growthFromModel(row),
      maturity: maturityFromModel(row),
      chain: num(row.chain_factor) !== null ? row.chain_factor : 1
    };
  }
  function impliedOf(row) {
    var f = factorsOf(row);
    if (f.peer === null || f.growth === null || f.maturity === null || f.chain === null) return null;
    if (num(row.tvl_usd) === null) return null;
    return Math.max(1, Math.round(row.tvl_usd * f.peer * f.growth * f.maturity * f.chain));
  }

  /* ---------- farm plan: the board's own steps, shown verbatim ---------- */
  // A step is one string: "<action> Cost: <cost>. Time: <time>." Split it only for
  // display; the words, the cost and the time are the board's, never recomputed here.
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
    if (ps.get('p')) state.selected = ps.get('p');
  }
  function writeHash() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.category !== 'all') ps.set('category', state.category);
    if (state.chain !== 'all') ps.set('chain', state.chain);
    if (state.tab !== 'pre-token') ps.set('tab', state.tab);
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
  function filteredRows() { return rows.filter(matches); }
  function filteredLive() { return live.filter(matches); }
  function sortVal(r, key) {
    if (key === 'name') return (r.name || '').toLowerCase();
    if (key === 'tvl') return num(r.tvl_usd) === null ? -1 : r.tvl_usd;
    if (key === 'growth') return num(r.change_7d) === null ? -Infinity : r.change_7d;
    if (key === 'age') return num(r.age_days) === null ? Infinity : r.age_days;
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
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: fmtUsd(DATA.floor_usd) }), ' of TVL that records no token. The early radar adds ', el('b', { text: String(num(DATA.early_size) === null ? 0 : DATA.early_size) + ' pre-token protocols' }), ' below that floor. Implied value is a model of what a token would be worth if the protocol\u2019s record stayed as it is — not a promise, and not a prediction that a token will launch.')
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
    var cats = [], chs = [];
    rows.concat(live).forEach(function (r) {
      if (cats.indexOf(catOf(r)) < 0) cats.push(catOf(r));
      chainsOf(r).forEach(function (c) { if (chs.indexOf(c) < 0) chs.push(c); });
    });
    cats.sort(); chs.sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' }, optionList(cats, state.category, 'All categories'));
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionList(chs, state.chain, 'All chains'));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label,
        onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'seg' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'))),
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
  function emptyState() {
    return el('div', { class: 'board' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Nothing on the board fits this search, category or chain. Clear the filters to see the full radar again.' }),
      el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
    ));
  }
  function boardTable() {
    var list = sorted(filteredRows());
    if (!list.length) return emptyState();
    var max = Math.max.apply(null, list.map(function (r) { return num(r.implied_value_usd) || 0; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var pct = max ? Math.max(3, Math.round((num(r.implied_value_usd) || 0) / max * 100)) : 3;
      var tr = el('tr', {
        'data-rank': String(r.rank), tabindex: '0', class: r.rank <= 3 ? 'top3' : null,
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        protoCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'value-cell' },
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortTh('implied', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL'), sortTh('growth', '7d'), sortTh('age', 'Age'), sortTh('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token' })
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
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { text: 'Live-token protocols, largest market cap first. Their market cap is a fact from the market, not a model — so they are set aside from the pre-token ranking and never scored by implied value.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    ));
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
    return parts.join(' ') + (extra.length ? '  —  ' + extra.join('; ') : '');
  }
  function methodPanel() {
    var peerNote = 'The peer multiple is the median TVL / market cap of the live-token protocols in the same category. When a category has few live protocols, its median is blended with the global median across all live protocols, so one thin category cannot set an extreme multiple on its own. The multiple is clamped to 0.5 – 20.';
    return el('section', { class: 'method' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'One function scores every row, from the snapshot\u2019s own figures only. No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formulaText() }),
      el('ul', null,
        el('li', null, el('b', { text: 'Peer multiple. ' }), peerNote),
        el('li', null, el('b', { text: 'Growth multiplier. ' }), 'Seven-day TVL change, clamped so a single hot week cannot dominate the board, then weighted into a multiplier near 1. A missing 7-day figure counts as no growth.'),
        el('li', null, el('b', { text: 'Maturity multiplier. ' }), 'How long the protocol has run since it was first listed with no token. Older listings score higher, up to a cap — longevity is evidence the record is real, not a promise of a launch. An unlisted age uses a neutral middle value.'),
        el('li', null, el('b', { text: 'Chain factor. ' }), 'A small adjustment for the protocol\u2019s chain footprint, stored per row and kept close to 1, so chain count alone never decides a rank.')
      ),
      el('p', { text: "The board applies the house watchlist's own exclusion rule to every row: no wrapped, staked or bridged product of a token that already trades, no exchange product, and no versioned pool. The radar ranks only protocols still waiting on a launch of their own." }),
      el('p', { class: 'note' }, el('b', { text: 'What the model does not do: ' }), 'it does not predict whether or when a token will launch, it does not use social buzz, prices or any figure outside the snapshot, and it never treats one protocol differently because of its name.')
    );
  }
  function footer() {
    return el('footer', { class: 'foot' },
      el('span', null, 'Snapshot ', el('b', { text: DATA.as_of || 'n/a' }), ' · DefiLlama protocol index · Model ', el('b', { text: VERSION })),
      el('span', { text: 'Implied values are model estimates from TVL, growth, age and peer multiples. They are not prices, not advice, and not a prediction that any token will launch.' })
    );
  }

  /* ---------- detail dialog ---------- */
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { if (state.selected) { state.selected = null; writeHash(); } });
  function eqRow(label, value) {
    return el('div', { class: 'row' }, el('span', { text: label }), el('b', { text: value }));
  }
  function openDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var f = factorsOf(row);
    var recomputed = impliedOf(row);
    var check;
    if (recomputed === null) check = el('p', { class: 'check na', text: 'Recompute unavailable: a model factor is missing from this row, so the page cannot check the board figure. The board figure is shown as recorded.' });
    else if (recomputed === row.implied_value_usd) check = el('p', { class: 'check ok', text: 'Recomputed ' + fmtUsd(recomputed) + ' — matches board.json.' });
    else check = el('p', { class: 'check warn', text: 'Recomputed ' + fmtUsd(recomputed) + ' — does NOT match the board figure ' + fmtUsd(row.implied_value_usd) + '. Treat the board figure as stale until the data is rebuilt.' });
    var inner = el('div', { class: 'detail-inner' },
      el('div', { class: 'detail-top' },
        el('div', null,
          el('span', { class: 'rank-tag', text: 'Rank ' + row.rank + ' of ' + (num(DATA.board_size) === null ? rows.length : DATA.board_size) }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: catOf(row) + ' · ' + (chainsOf(row).join(', ') || 'chain not listed') + ' · listed ' + (row.listed_at || 'date unknown') })
        ),
        el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close details', text: '\u00D7', onclick: function () { dialog.close(); } })
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Implied value — the equation' }),
        el('div', { class: 'equation' },
          eqRow('TVL', fmtUsd(row.tvl_usd)),
          eqRow('Peer multiple (median TVL / market cap, live peers in this category)', fmtMult(f.peer)),
          eqRow('Growth multiplier (7d ' + fmtPct(row.change_7d) + ')', fmtMult(f.growth)),
          eqRow('Maturity multiplier (age ' + fmtAge(row.age_days) + ')', fmtMult(f.maturity)),
          eqRow('Chain factor (' + chainsOf(row).length + ' chain' + (chainsOf(row).length === 1 ? '' : 's') + ')', fmtMult(f.chain)),
          el('div', { class: 'row total' }, el('span', { text: '= Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
        ),
        check
      ),
      el('section', { class: 'detail-sec' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'farm' }, (Array.isArray(row.farm_steps) ? row.farm_steps : []).map(function (s) {
          var p = splitStep(s);
          if (p.cost === null) return el('li', null, el('b', { text: p.action }));
          if (p.time === null) return el('li', null, el('b', { text: p.action }), el('span', { class: 'cost', text: 'Cost: ' + p.cost }));
          return el('li', null, el('b', { text: p.action }), el('span', { class: 'cost', text: 'Cost: ' + p.cost + ' · Time: ' + p.time }));
        }))
      ),
      el('p', { class: 'risk' }, el('b', { text: 'Risk note. ' }), 'This protocol records no token — this is an estimate, not a price, and not a prediction that a token will launch. Only farm with funds you can afford to leave locked, and verify every step on the protocol\u2019s own pages.')
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
    wrap.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') wrap.appendChild(methodPanel());
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
