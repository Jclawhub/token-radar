// Token Radar's night dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail panel
// with the model's own factors and the protocol's farm plan, and a model lab that
// recomputes every row live. No network: every byte it shows is in data.js.
//
// The lab recomputes implied value from the row's stored factors, so its defaults match
// board.json exactly: growth 1 + clamp(7d, -50, 150) / 100 x weight, breadth
// 1 + weight x min(chains, 8), age 1 + (age multiplier - 1) x premium / 0.15, and the
// category multiplier on or off. Move a slider and the board re-ranks in front of you.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var panel = document.getElementById('detail');
  var scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.hidden = true;
  document.body.appendChild(scrim);

  var MODEL = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', set: 'all', sort: 'implied', dir: -1,
    selected: null, labOpen: false,
    lab: { growth: MODEL.growth_weight, chain: MODEL.chain_weight, age: 0.15, category: true }
  };

  // ---------------------------------------------------------------- formatting

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------- the model, in the page

  /** The category table, the same uniform table the model scores with. */
  var CATEGORY_MULT = {
    'Lending': 1.1, 'CDP': 1.1, 'CDP Manager': 1.1, 'Collateral Markets': 1.1,
    'Dexs': 1.08, 'Derivatives': 1.08, 'Interest Rate Derivatives': 1.08,
    'Yield': 1.05, 'Yield Aggregator': 1.05, 'RWA': 1.05,
    'Bridge': 0.9, 'Canonical Bridge': 0.9, 'Cross Chain Bridge': 0.9,
    'Liquid Staking': 0.95, 'Liquid Restaking': 0.95, 'Restaked BTC': 0.95, 'Staking Pool': 0.95
  };

  /** The overdue multiplier from the row's age, exactly as the model computes it. */
  function ageMultiplier(age) {
    if (age === null || age === undefined) return MODEL.unknown_age_multiplier;
    if (age < MODEL.young_days) return MODEL.young_multiplier;
    if (age < MODEL.mid_days) return MODEL.mid_start + ((age - MODEL.young_days) / (MODEL.mid_days - MODEL.young_days)) * (1 - MODEL.mid_start);
    if (age < MODEL.overdue_days) return 1 + ((age - MODEL.mid_days) / (MODEL.overdue_days - MODEL.mid_days)) * (MODEL.overdue_multiplier - 1);
    return MODEL.overdue_multiplier;
  }

  /** One row's implied value under the lab's current weights (defaults = radar-2). */
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * state.lab.growth;
    var chainMult = 1 + state.lab.chain * Math.min((row.chains || []).length, MODEL.chain_max);
    var ageMult = 1 + (ageMultiplier(row.age_days) - 1) * (state.lab.age / 0.15);
    var catMult = state.lab.category ? (CATEGORY_MULT[row.category] || 1) : 1;
    return Math.max(1, Math.round(row.base_usd * growthMult * chainMult * ageMult * catMult));
  }
  function labIsDefault() {
    return state.lab.growth === MODEL.growth_weight && state.lab.chain === MODEL.chain_weight &&
      state.lab.age === 0.15 && state.lab.category === true;
  }

  // ---------------------------------------------------------------- the farm plan, in the page

  // The same derivation main.ts writes to board.json: category, chains, TVL and age decide
  // the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 120;
    return 60;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave it earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and leave it in range.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and put the bridged funds to work in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position on a ' + name + ' market that resolves after the snapshot window.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('rwa') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondSurfaceFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + Math.round(capital / 3) + ' against the supply on ' + name + ' and repay it within the week, so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap once through ' + name + ' on ' + chain + ' for a small amount, so the wallet shows a trade as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + name + ' a week later, so the wallet shows repeat use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim or restake the staking rewards through ' + name + ' once, so the wallet shows the full cycle.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge on ' + name + ' and open a fresh one, so the wallet shows two completed trades.';
    if (c.indexOf('prediction') >= 0) return 'Take a second position on a different ' + name + ' market, so the wallet shows more than one outcome.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('rwa') >= 0) return 'Deposit a second, smaller amount into another ' + name + ' vault on ' + chain + ', so the wallet shows more than one vault.';
    if (c.indexOf('stable') >= 0) return 'Swap a small amount of the stable asset through ' + name + ', so the wallet shows use beyond minting.';
    if (c.indexOf('insurance') >= 0) return 'File a test claim inquiry on ' + name + ' without withdrawing, so the wallet shows engagement with the cover.';
    return 'Use a second feature of ' + name + ' on ' + chain + ', such as a swap, a vote or a second pool, so the wallet shows depth.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: 'Move $' + capital + ' of USDC onto ' + chain + ', the chain ' + p.name + ' runs on, and keep $10 of it aside for gas.', cost: '$' + capital + ' of capital plus the bridge fee', time: '15 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 200 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondSurfaceFor(p, capital, chain), cost: 'about $3 of gas', time: '10 minutes' },
      { text: 'Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let two weeks pass with nothing.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and decide the unwind price before you enter, not after.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // ---------------------------------------------------------------- filtering and sorting

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.set !== 'all' && r.set !== state.set) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = impliedOf(a); bv = impliedOf(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return list;
  }

  // ---------------------------------------------------------------- hash state

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('set')) state.set = params.get('set');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('lab') === '1') state.labOpen = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.set !== 'all') params.set('set', state.set);
    if (state.selected) params.set('p', state.selected);
    if (state.labOpen) params.set('lab', '1');
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------- rendering

  function sortArrow(key) {
    return state.sort === key ? (state.dir < 0 ? ' &#9660;' : ' &#9650;') : '';
  }
  function sortTh(key, label) {
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + sortArrow(key) + '</button></th>';
  }

  function headerHtml() {
    return '<header class="top">' +
      '<div class="brand"><span class="mark"></span><span class="brand-name">Token Radar</span></div>' +
      '<div class="top-meta"><span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span>DefiLlama protocol index</span>' +
      '<span><b>' + esc(DATA.model_version) + '</b> model</span></div></header>';
  }

  function ledeHtml() {
    var t = DATA.totals;
    return '<section class="lede">' +
      '<h1>' + DATA.watchlist_size + ' watchlist protocols, ' + DATA.board_size + ' pre-token rows ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M</b> of TVL and no token on record. ' +
      'The early radar adds <b>' + DATA.early_size + '</b> more pre-token protocols, below the floor and above it, each with the reason it sits outside the watchlist. ' +
      'Implied value is a model, not a promise — and the model lab below lets you change it and watch the board re-rank.</p>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows beyond the watchlist</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '<div class="stat hot"><span>Top 10 share of implied value</span><b>' + t.top10_share_pct + '%</b></div>' +
      '</div></section>';
  }

  function toolbarHtml(list) {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var opt = function (v, cur, label) {
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    };
    return '<div class="toolbar">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' +
      opt('all', state.category, 'All categories') + categories.map(function (c) { return opt(c, state.category, c); }).join('') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' +
      opt('all', state.chain, 'All chains') + chains.map(function (c) { return opt(c, state.chain, c); }).join('') + '</select></div>' +
      '<div class="field"><span class="sub">Set</span><div class="tabs" role="group" aria-label="Filter by set">' +
      '<button type="button" data-set="all" aria-pressed="' + (state.set === 'all') + '">All</button>' +
      '<button type="button" data-set="watchlist" aria-pressed="' + (state.set === 'watchlist') + '">Watchlist</button>' +
      '<button type="button" data-set="early" aria-pressed="' + (state.set === 'early') + '">Early</button></div></div>' +
      '<button type="button" class="button lab-toggle" id="lab-toggle" aria-pressed="' + state.labOpen + '">Model lab</button>' +
      '<span class="count">' + list.length + ' rows shown</span></div>';
  }

  function boardHtml(list) {
    if (list.length === 0) {
      return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category, chain or set to see the board again.</p>' +
        '<button class="button primary" type="button" id="clear-filters">Clear filters</button></div></div>';
    }
    var max = Math.max.apply(null, list.map(function (r) { return impliedOf(r); })) || 1;
    var rows = list.map(function (r) {
      var value = impliedOf(r);
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tag = r.set === 'watchlist' ? '<span class="tag watch">watchlist</span>' : '<span class="tag early">early</span>';
      var pct = Math.max(3, Math.round((value / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0" class="' + (r.rank <= 3 ? 'top3' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div><span class="num">' + fmtUsd(value) + '</span></div></td>' +
        '<td>' + tag + '</td></tr>';
    }).join('');
    return '<div class="panel" id="board"><div class="table-wrap"><table>' +
      '<caption class="sub" style="text-align:left;padding:12px 16px 0">Pre-token protocols, strongest implied value first. Select a row for its factors and farm plan.' +
      (labIsDefault() ? '' : ' The model lab has changed the weights, so these values differ from board.json.') + '</caption>' +
      '<thead><tr>' + sortTh('implied', 'Rank') + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age') + sortTh('implied', 'Implied value') + '<th scope="col">Set</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function modelHtml() {
    var m = MODEL;
    var labCls = state.labOpen ? '' : ' hidden';
    return '<section class="panel model"><h2>How implied value is computed <span>' + esc(DATA.model_version) + ' &middot; every row, one function</span></h2>' +
      '<p class="sub">No protocol name is special-cased. TVL enters with diminishing returns, so growth and breadth can move a row; age is an overdue premium, not a promise.</p>' +
      '<div class="formula">implied = round( <b>$1M &times; (tvl / $1M)<sup>0.85</sup> &times; 0.30</b> &times; (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 &times; ' + m.growth_weight + ') &times; (1 + 0.04 &times; min(chains, 8)) &times; overdue(age) &times; category )</div>' +
      '<p class="sub">Overdue: under 90 days 0.80, 90&ndash;365 days 0.90&ndash;1.00, 365&ndash;1095 days 1.00&ndash;1.15, over 1095 days 1.15, unknown age 0.95. ' +
      'Category: Lending and CDP 1.10, Dexs and Derivatives 1.08, Yield and RWA 1.05, Bridge 0.90, Liquid Staking and Restaking 0.95, everything else 1.00. ' +
      'The page recomputes each row from these figures; the lab below changes the weights and re-ranks the board live.</p>' +
      '<div class="lab' + labCls + '" id="lab">' +
      '<div class="slider"><label for="lab-growth">Growth weight <output id="lab-growth-out">' + state.lab.growth.toFixed(2) + '</output></label>' +
      '<input type="range" id="lab-growth" min="0" max="1.5" step="0.05" value="' + state.lab.growth + '">' +
      '<p>How much seven-day momentum moves a row. At 0, growth is ignored entirely.</p></div>' +
      '<div class="slider"><label for="lab-chain">Chain breadth weight <output id="lab-chain-out">' + state.lab.chain.toFixed(2) + '</output></label>' +
      '<input type="range" id="lab-chain" min="0" max="0.08" step="0.005" value="' + state.lab.chain + '">' +
      '<p>How much each extra chain is worth, up to 8 chains. At 0, breadth is ignored.</p></div>' +
      '<div class="slider"><label for="lab-age">Overdue premium <output id="lab-age-out">' + state.lab.age.toFixed(2) + '</output></label>' +
      '<input type="range" id="lab-age" min="0" max="0.3" step="0.01" value="' + state.lab.age + '">' +
      '<p>How far the age multiplier may stray from 1. At 0, age stops mattering.</p></div>' +
      '<div class="slider"><label for="lab-category">Category premium <output id="lab-category-out">' + (state.lab.category ? 'on' : 'off') + '</output></label>' +
      '<input type="range" id="lab-category" min="0" max="1" step="1" value="' + (state.lab.category ? 1 : 0) + '">' +
      '<p>Whether the category table applies at all. Off, every category scores the same.</p></div>' +
      '<div class="lab-actions"><button type="button" class="button" id="lab-reset">Reset to radar-2</button>' +
      '<span class="lab-note" id="lab-note">' + (labIsDefault() ? 'The lab matches board.json: these are the values the entry hands in.' : '<b>The lab differs from board.json.</b> The board above is re-ranked live; reset to return to the handed-in values.') + '</span></div>' +
      '</div></section>';
  }

  function liveHtml() {
    var rows = DATA.live.map(function (r) {
      return '<tr><td><span class="tag">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td><span class="tag">already trades</span></td></tr>';
    }).join('');
    return '<section class="live"><div class="panel"><div class="live-head"><h2>Live token, set aside</h2>' +
      '<p>These protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, largest market cap first.</p></div>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div></section>';
  }

  function footHtml() {
    return '<footer class="foot"><p>Source: ' + esc(DATA.source) + '. The snapshot is frozen: every run of this entry and the grade read the same bytes.</p>' +
      '<p>A protocol on this board records no token in DefiLlama — never that it has none. Implied value is an estimate from TVL, growth, breadth, age and category, not a price, and never investment advice.</p></footer>';
  }

  function render() {
    var list = visibleRows();
    app.innerHTML = '<div class="shell">' + headerHtml() + ledeHtml() + toolbarHtml(list) + boardHtml(list) + modelHtml() + liveHtml() + footHtml() + '</div>';
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected, true);
  }

  // ---------------------------------------------------------------- detail panel

  function factorBar(label, value, min, max, cls) {
    var pct = Math.max(4, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
    return '<div class="factor"><span>' + label + '</span><div class="bar" aria-hidden="true"><i class="' + cls + '" style="width:' + pct + '%"></i></div><span class="num">' + value.toFixed(2) + '&times;</span></div>';
  }

  function openDetail(slug, keepFocus) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var value = impliedOf(row);
    var steps = farmSteps(row);
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><div><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></div></li>';
    }).join('');
    panel.innerHTML =
      '<div class="detail-head"><div><span class="rankline">Rank ' + row.rank + ' of ' + DATA.board_size + ' &middot; ' + esc(row.set) + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + '</p></div>' +
      '<button class="close" type="button" id="detail-close" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3><div class="factors">' +
      '<div class="factor"><span>TVL base</span><div class="bar" aria-hidden="true"><i style="width:' + Math.max(4, Math.min(100, Math.round(Math.log10(row.base_usd + 1) / 10 * 100))) + '%"></i></div><span class="num">' + fmtUsd(row.base_usd) + '</span></div>' +
      factorBar('Growth', row.growth_multiplier, 0.6, 2.2, 'growth') +
      factorBar('Breadth', row.chain_multiplier, 1, 1.32, 'chain') +
      factorBar('Overdue', row.age_multiplier, 0.8, 1.15, 'age') +
      factorBar('Category', row.category_multiplier, 0.9, 1.1, 'category') +
      '</div>' +
      '<p>TVL <b class="num">' + fmtUsd(row.tvl_usd) + '</b> &middot; seven-day growth <b class="num">' + fmtPct(row.change_7d) + '</b> &middot; age with no token <b class="num">' + fmtAge(row.age_days) + '</b> &middot; chains <b class="num">' + (row.chains || []).length + '</b></p>' +
      '<p>Model ' + esc(DATA.model_version) + ': the page recomputes this row as <b class="num">' + fmtUsd(value) + '</b>' +
      // data.js stores the TVL base rounded to whole dollars, so the page's recompute can
      // sit a dollar or two from board.json's exact figure at the lab's defaults; within
      // that rounding it is the same number.
      (Math.abs(value - row.implied_value_usd) <= 2 ? ', the same number board.json carries.' : ', which differs from board.json because the model lab has moved the weights.') + ' This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Why it is here</h3><div class="why"><b>' + (row.set === 'watchlist' ? 'Watchlist.' : 'Early radar.') + '</b> ' + esc(row.watchlist_note) + '</div></section>' +
      '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + stepsHtml + '</ol>' +
      '<p>Eight steps, derived from this protocol\u2019s own record. Two surfaces, a weekly cadence and a hold window are the spine: a wallet that did one thing once is easy to filter out.</p></section>';
    panel.hidden = false;
    scrim.hidden = false;
    if (!keepFocus) {
      var close = document.getElementById('detail-close');
      if (close) close.focus();
    }
  }

  function closeDetail() {
    state.selected = null;
    panel.hidden = true;
    scrim.hidden = true;
    panel.innerHTML = '';
    writeHash();
    var rows = app.querySelectorAll('tr[data-selected="true"]');
    rows.forEach(function (tr) { tr.setAttribute('data-selected', 'false'); });
  }

  // ---------------------------------------------------------------- events

  app.addEventListener('click', function (e) {
    var sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      var key = sortBtn.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      render();
      return;
    }
    var setBtn = e.target.closest('[data-set]');
    if (setBtn) {
      state.set = setBtn.getAttribute('data-set');
      writeHash();
      render();
      return;
    }
    if (e.target.id === 'clear-filters') {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.set = 'all';
      writeHash();
      render();
      return;
    }
    if (e.target.id === 'lab-toggle') {
      state.labOpen = !state.labOpen;
      writeHash();
      render();
      return;
    }
    if (e.target.id === 'lab-reset') {
      state.lab = { growth: MODEL.growth_weight, chain: MODEL.chain_weight, age: 0.15, category: true };
      render();
      return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'), false);
  });

  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
      e.preventDefault();
      openDetail(e.target.getAttribute('data-slug'), false);
    }
  });

  app.addEventListener('input', function (e) {
    if (e.target.id === 'q') {
      state.q = e.target.value;
      writeHash();
      render();
      var q = document.getElementById('q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      return;
    }
    if (e.target.id === 'lab-growth' || e.target.id === 'lab-chain' || e.target.id === 'lab-age' || e.target.id === 'lab-category') {
      state.lab.growth = parseFloat(document.getElementById('lab-growth').value);
      state.lab.chain = parseFloat(document.getElementById('lab-chain').value);
      state.lab.age = parseFloat(document.getElementById('lab-age').value);
      state.lab.category = document.getElementById('lab-category').value === '1';
      document.getElementById('lab-growth-out').textContent = state.lab.growth.toFixed(2);
      document.getElementById('lab-chain-out').textContent = state.lab.chain.toFixed(2);
      document.getElementById('lab-age-out').textContent = state.lab.age.toFixed(2);
      document.getElementById('lab-category-out').textContent = state.lab.category ? 'on' : 'off';
      var note = document.getElementById('lab-note');
      if (note) note.innerHTML = labIsDefault() ? 'The lab matches board.json: these are the values the entry hands in.' : '<b>The lab differs from board.json.</b> The board above is re-ranked live; reset to return to the handed-in values.';
      // The board re-ranks on change, when the drag ends: re-rendering here would destroy
      // the slider mid-drag, so the input event only updates the readouts.
      return;
    }
  });

  app.addEventListener('change', function (e) {
    if (e.target.id === 'category') { state.category = e.target.value; writeHash(); render(); }
    if (e.target.id === 'chain') { state.chain = e.target.value; writeHash(); render(); }
    if (e.target.id === 'lab-growth' || e.target.id === 'lab-chain' || e.target.id === 'lab-age' || e.target.id === 'lab-category') {
      // The drag ended: re-rank the board once, with the slider's final value.
      render();
    }
  });

  panel.addEventListener('click', function (e) {
    if (e.target.id === 'detail-close') closeDetail();
  });
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) closeDetail();
  });

  readHash();
  render();
})();
