// Radar model for token-radar-01: peer-priced implied value for pre-token protocols.
//
// The snapshot gives each protocol ten fields and nothing else: no ranking, no implied value, no
// farm plan. This file derives all three from the snapshot alone, deterministically, with no clock,
// no randomness and no protocol name ever special-cased.
//
// The implied value of a protocol that records no token is its TVL priced at the multiple the
// market already pays for live protocols in the same category:
//
//   implied = round(TVL x peerMultiple x growthMult x maturityMult x chainFactor)
//
// peerMultiple is the median TVL / market-cap ratio of the live protocols in the protocol's own
// category (ratios outside (0, 1000] are ignored), blended toward the global median when the
// category has fewer than five live protocols, then clamped to [0.5, 20]. The medians are computed
// from the snapshot at runtime, never hardcoded.
//
// growthMult rewards a protocol whose TVL grew over the last seven days and discounts one whose
// TVL shrank. maturityMult rewards a protocol that has run a long time with no token yet: a
// protocol that survived years without issuing one is a steadier launch candidate than a new one.
// chainFactor rewards a protocol that already runs on several chains.
//
// The board applies the house watchlist's own exclusion rule to every row, watchlist or not:
// no wrapped, staked or bridged product of a token that already trades, no exchange product,
// and no versioned pool. The radar ranks only protocols still waiting on a launch of their own,
// so a wrapped or staked derivative of a live token can never top the board. The rule reads
// category and name only: parentProtocol is DefiLlama's record and is not one of the snapshot's
// ten fields, so it cannot be checked here — exactly as RULES.txt defines the watchlist.
//
// The board ranks every rankable pre-token protocol: the whole 40-protocol watchlist plus every
// other pre-token protocol below the watchlist floor that passes the exclusion rule. Live
// protocols (a token already trades) are kept apart in their own list, priced by the
// market's own market cap, never by this model.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_blend_min: number;
  peer_min: number;
  peer_max: number;
  ratio_max: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_blend_min: 5,
  peer_min: 0.5,
  peer_max: 20,
  ratio_max: 1000,
  chain_step: 0.05,
  chain_max_extra: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row, compact, for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_factor: number;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimals, for the breakdown the board carries. */
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer multiples: one per category plus the global one. A live protocol is one that records a
 * token (a market cap above zero) and is not an exchange; its ratio is its TVL over its market
 * cap. Ratios at or below zero or above the cap are discarded as noise.
 */
export interface PeerTable {
  global: number;
  byCategory: Map<string, { multiple: number; n: number }>;
}

export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = p.tvl_usd / p.mcap_usd;
    if (!(ratio > 0) || ratio > model.ratio_max) continue;
    allRatios.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = median(allRatios) ?? 1;
  const byCategory = new Map<string, { multiple: number; n: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    const catMedian = median(ratios)!;
    const n = ratios.length;
    // Thin categories borrow strength from the market as a whole: a blend weighted by how many
    // live protocols the category actually has.
    const blended = n < model.peer_blend_min ? (n * catMedian + model.peer_blend_min * global) / (n + model.peer_blend_min) : catMedian;
    const clamped = Math.min(model.peer_max, Math.max(model.peer_min, blended));
    byCategory.set(key, { multiple: round4(clamped), n });
  }
  return { global: round4(Math.min(model.peer_max, Math.max(model.peer_min, global))), byCategory };
}

/** The peer multiple a protocol gets: its category's, or the global one when its category has none. */
export function peerMultipleFor(p: SnapshotProtocol, table: PeerTable): number {
  const entry = table.byCategory.get(p.category ?? '');
  return entry === undefined ? table.global : entry.multiple;
}

/** The growth multiplier from a protocol's seven-day TVL change, clamped to the model's window. */
export function growthMultiplier(p: SnapshotProtocol, model: ModelConstants = MODEL): { pct: number; mult: number } {
  const raw = finite(p.change_7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/** The maturity multiplier from a protocol's age in days; an unknown age counts as a year. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The chain factor from how many chains a protocol runs on: up to four extra chains count. */
export function chainFactor(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_extra);
  return 1 + model.chain_step * extra;
}

/** The scored value of one protocol under the model, with every multiplier that produced it. */
export interface Scored {
  implied: number;
  peerMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainFactorValue: number;
  age: number | null;
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, table: PeerTable, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const peerMultiple = peerMultipleFor(p, table);
  const { pct, mult } = growthMultiplier(p, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainFactorValue = chainFactor(p, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * mult * maturityMult * chainFactorValue));
  return { implied, peerMultiple, growthPct: pct, growthMult: mult, maturityMult, chainFactorValue, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house watchlist rule excludes outright. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word in a name that marks a wrapped, staked or staking product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

/**
 * Whether a protocol fails the house watchlist's own exclusion rule: its category is Bridge,
 * Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; its name ends in a
 * version marker; its name carries a whole word wrapped, staked or staking; or its name begins
 * with an exchange's name. parentProtocol is DefiLlama's record and is not one of the snapshot's
 * ten fields, so the rule cannot check it — it reads category and name only, exactly as
 * RULES.txt defines the watchlist.
 */
export function isExcludedByWatchlistRule(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the exclusion rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcludedByWatchlistRule(p);
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: the watchlist plus every other rankable pre-token protocol, strongest first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = peerTable(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its TVL. A watchlist
  // protocol that failed the exclusion rule would be a contradiction in the data itself — the
  // rule is what built the watchlist — so it is refused loudly here, never silently dropped.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) {
      if (isExcludedByWatchlistRule(p)) {
        throw new SnapshotError(`watchlist protocol ${slug} (${p.name}) fails the watchlist exclusion rule: the snapshot contradicts its own watchlist`);
      }
      chosen.set(slug, p);
    }
  }
  // The early radar: every other rankable pre-token protocol, below the floor or not. A chosen
  // protocol stays chosen; nothing here replaces a watchlist row.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, table, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // The growth, maturity and chain multipliers are stored at full double precision,
      // exactly as scoreProtocol used them: rounding them here made the page's recompute
      // from the stored factors never match the board figure. The peer multiple is the
      // peer table's own value (rounded there, and implied is computed from that same
      // value), and growth_pct is display-only, so it stays rounded.
      peer_multiple: s.peerMultiple,
      growth_pct: round4(s.growthPct),
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_factor: s.chainFactorValue,
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

/** One step as a single string: action, cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, from the chain's own fee level. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $8-15 of gas';
  if (c.includes('solana')) return 'about $0.05 of gas';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism')) return 'about $0.50-2 of gas';
  if (c.includes('bnb') || c.includes('binance')) return 'about $0.30 of gas';
  return 'about $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The qualifying action for a category, found by keyword so no protocol name is ever listed. The
 * categories in the snapshot are matched in order from the most specific phrase to the most
 * general; an unmatched category falls back to a plain deposit.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('restak')) return `Restake $${capital} of the receipt token through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('allocator') || c.includes('curator') || c.includes('leveraged farm') || c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action for a category, matched by the same keywords as the main action. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('prediction')) return 'place one small market position or settle one market';
  if (c.includes('perpetual') || c.includes('derivative')) return 'adjust the hedge or open one small trade';
  if (c.includes('restak') || c.includes('staking')) return 'top up the stake or claim the staking rewards';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'add a small deposit, borrow a little, or repay a little';
  if (c.includes('dex')) return 'swap a small amount or rebalance the pool position';
  if (c.includes('bridge')) return 'bridge a small amount between chains';
  if (c.includes('rwa') || c.includes('stable')) return 'mint a little more or check the yield accrual';
  if (c.includes('insurance')) return 'renew the cover or check the policy status';
  return 'make a deposit, a swap, or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and nothing else.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as ${weekly}, so the wallet shows steady activity.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes, and never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_factor: row.model.chain_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
