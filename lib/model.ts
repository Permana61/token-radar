// Radar model for token-radar-01, version 3 ("radar-3"): peer-priced implied value with a
// calibrated peer multiple, a snapshot-derived risk score, and a risk-adjusted ranking.
//
// The snapshot gives each protocol ten fields and nothing else: no ranking, no implied value, no
// farm plan. This file derives all three from the snapshot alone, deterministically, with no clock,
// no randomness and no protocol name ever special-cased.
//
// The implied value of a protocol that records no token is its TVL priced at the multiple the
// market already pays for live protocols in the same category, then adjusted for risk:
//
//   implied_raw = TVL x peerMultiple x growthMult x maturityMult x chainFactor
//   implied     = implied_raw x (1 - riskDiscount),  riskDiscount = riskScore x 0.005
//
// peerMultiple is the median TVL / market-cap ratio of the live protocols in the protocol's own
// category, with each live ratio winsorized to [0.05, 30] first so one thinly-traded outlier
// cannot set the multiple, then shrunk toward the global median by peer count (a category with
// two live protocols borrows most of its multiple from the market as a whole), then clamped to
// [0.5, 10]. The medians are computed from the snapshot at runtime, never hardcoded. Version 2
// clamped at 20 and blended only below five peers, so a two-protocol category with a 111x median
// priced its protocols at the 20x clamp: the top of the board was a multiple, not a ranking.
//
// growthMult rewards a protocol whose TVL grew over the last seven days and discounts one whose
// TVL shrank. maturityMult rewards a protocol that has run a long time with no token yet: a
// protocol that survived years without issuing one is a steadier launch candidate than a new one.
// chainFactor rewards a protocol that already runs on several chains.
//
// The risk score (0-100) is built only from the snapshot's own fields: single-chain
// concentration, young age, shrinking TVL, small TVL against its category's median, thin live
// peer evidence, and an execution-risk component set by the category (DEX and derivatives pay
// MEV and slippage on entry, bridges pay bridge risk, lending pays liquidation risk, restaking
// pays slashing risk). The board ranks by the risk-adjusted value, and every row carries the raw
// value, the score, its components and the readiness tier, so the page can show the whole
// working and recompute it.
//
// The board applies the house watchlist's own exclusion rule to every row, watchlist or not:
// no wrapped, staked or bridged product of a token that already trades, no exchange product,
// and no versioned pool. The radar ranks only protocols still waiting on a launch of their own,
// so a wrapped or staked derivative of a live token can never top the board. The rule reads
// category and name only: parentProtocol is DefiLlama's record and is not one of the snapshot's
// ten fields, so it cannot be checked here — exactly as RULES.txt defines the watchlist.
//
// Live protocols (a token already trades) are kept apart in their own list, priced by the
// market's own market cap, never by this model. Their multiples are the live pricing the
// dashboard's Live panel shows beside the pre-token board.

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
  peer_blend_k: number;
  peer_min: number;
  peer_max: number;
  ratio_clip_lo: number;
  ratio_clip_hi: number;
  chain_step: number;
  chain_max_extra: number;
  risk_discount_per_point: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_blend_k: 8,
  peer_min: 0.5,
  peer_max: 10,
  ratio_clip_lo: 0.05,
  ratio_clip_hi: 30,
  chain_step: 0.05,
  chain_max_extra: 4,
  risk_discount_per_point: 0.005,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The six risk components, each a whole number of points, summing to the risk score. */
export interface RiskParts {
  concentration: number;
  age: number;
  growth: number;
  size: number;
  peers: number;
  execution: number;
}

/** A risk tier: Low below 25, Moderate below 50, High below 70, Very high at 70 and above. */
export type RiskTier = 'Low' | 'Moderate' | 'High' | 'Very high';

/** A launch-readiness tier from age, TVL and growth alone. */
export type ReadinessTier = 'Ready' | 'Watching' | 'Early';

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
  implied_raw_usd: number;
  risk_score: number;
  risk_tier: RiskTier;
  readiness: ReadinessTier;
  momentum_pct: number | null;
  capital_usd: number;
  peer_n: number;
  model: {
    peer_multiple: number;
    peer_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_factor: number;
    age_days: number | null;
    risk_score: number;
    risk_parts: RiskParts;
    momentum_pct: number | null;
    readiness: ReadinessTier;
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
  implied_raw_usd: number;
  risk_score: number;
  risk_tier: RiskTier;
  readiness: ReadinessTier;
  momentum_pct: number | null;
  capital_usd: number;
  peer_n: number;
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_factor: number;
  risk_parts: RiskParts;
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

/** One category's live pricing: the multiple the market pays there, and how many live
 * protocols priced it. The dashboard's Live panel reads this table. */
export interface CategoryStat {
  category: string;
  multiple: number;
  n: number;
  median_change_7d: number | null;
  median_tvl_usd: number;
}

/** Everything the dashboard needs: the board, the live set, the category pricing, and the model. */
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
  categories: CategoryStat[];
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

/** Clip a number into [lo, hi]. */
const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The peer multiples: one per category plus the global one. A live protocol is one that records a
 * token (a market cap above zero) and is not an exchange; its ratio is its TVL over its market
 * cap. Each ratio is winsorized to [ratio_clip_lo, ratio_clip_hi] before the median, so one
 * thinly-traded outlier cannot set a category's multiple, and the category median is then shrunk
 * toward the global median by peer count: a category with two live protocols borrows most of its
 * multiple from the market as a whole. The result is clamped to [peer_min, peer_max].
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
    if (!(ratio > 0) || ratio > 1000) continue;
    const clipped = clip(ratio, model.ratio_clip_lo, model.ratio_clip_hi);
    allRatios.push(clipped);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [clipped]);
    else list.push(clipped);
  }
  const global = median(allRatios) ?? 1;
  const byCategory = new Map<string, { multiple: number; n: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    const catMedian = median(ratios)!;
    const n = ratios.length;
    const shrunk = (n * catMedian + model.peer_blend_k * global) / (n + model.peer_blend_k);
    const clamped = clip(shrunk, model.peer_min, model.peer_max);
    byCategory.set(key, { multiple: round4(clamped), n });
  }
  return { global: round4(clip(global, model.peer_min, model.peer_max)), byCategory };
}

/** The peer multiple a protocol gets: its category's, or the global one when its category has none. */
export function peerMultipleFor(p: SnapshotProtocol, table: PeerTable): number {
  const entry = table.byCategory.get(p.category ?? '');
  return entry === undefined ? table.global : entry.multiple;
}

/** How many live protocols priced a protocol's category. */
export function peerCountFor(p: SnapshotProtocol, table: PeerTable): number {
  return table.byCategory.get(p.category ?? '')?.n ?? 0;
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

/** Per-category medians the risk score and momentum read: 7-day change and pre-token TVL. */
export interface CategoryMedians {
  changeByCategory: Map<string, number | null>;
  tvlByCategory: Map<string, number | null>;
}

export function categoryMedians(snapshot: Snapshot): CategoryMedians {
  const changeByCategory = new Map<string, number[]>();
  const tvlByCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '';
    if (p.change_7d !== null && Number.isFinite(p.change_7d)) {
      const list = changeByCategory.get(key);
      if (list === undefined) changeByCategory.set(key, [p.change_7d]);
      else list.push(p.change_7d);
    }
    if (isPreToken(p)) {
      const list = tvlByCategory.get(key);
      if (list === undefined) tvlByCategory.set(key, [p.tvl_usd]);
      else list.push(p.tvl_usd);
    }
  }
  const change = new Map<string, number | null>();
  for (const [k, v] of changeByCategory) change.set(k, median(v));
  const tvl = new Map<string, number | null>();
  for (const [k, v] of tvlByCategory) tvl.set(k, median(v));
  return { changeByCategory: change, tvlByCategory: tvl };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The execution-risk component of the risk score, set by the category's own wording. A DEX or
 * derivatives venue pays MEV and slippage on entry, a bridge pays bridge and counterparty risk,
 * a lending market pays liquidation risk, restaking pays slashing and curator risk; anything else
 * pays a plain execution risk. The label is what the detail view shows beside the points.
 */
export function executionRisk(p: SnapshotProtocol): { points: number; label: string; note: string } {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('prediction'))
    return { points: 10, label: 'MEV and slippage on entry', note: 'Swaps and perps on this venue pay MEV and slippage when you enter and exit: keep the trade small and check the quoted price before you confirm.' };
  if (c.includes('bridge'))
    return { points: 10, label: 'Bridge and counterparty risk', note: 'Bridged funds sit with the bridge until they land: verify the official bridge address and never bridge more than you can afford to have delayed.' };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return { points: 8, label: 'Liquidation risk', note: 'A borrowed position can be liquidated if the collateral falls: keep the health factor high and the borrowed amount small.' };
  if (c.includes('restak'))
    return { points: 8, label: 'Slashing and curator risk', note: 'Restaked receipts depend on the curator and the operators under it: a slashing event or a curator failure reaches the receipt token.' };
  if (c.includes('stable') || c.includes('rwa'))
    return { points: 6, label: 'Peg and issuer risk', note: 'A stable or real-world asset holds its value only while its backing and its issuer do: check the backing and the redemption terms first.' };
  return { points: 5, label: 'Execution risk on entry', note: 'Every farm pays gas and a little slippage to enter: keep the first position small and confirm the transaction before you add more.' };
}

/**
 * The six risk components, each a whole number of points, from the snapshot's own fields only:
 * how many chains the protocol runs on, how old its record is, whether its TVL grew or shrank in
 * the last seven days, how its TVL compares with its category's pre-token median, how many live
 * protocols priced its category, and the execution risk its category carries. No name is ever
 * special-cased: two protocols with the same record score the same.
 */
export function riskParts(
  p: SnapshotProtocol,
  age: number | null,
  medians: CategoryMedians,
  table: PeerTable,
): RiskParts {
  const chains = p.chains.length;
  const concentration = chains <= 1 ? 25 : chains === 2 ? 12 : chains === 3 ? 6 : 0;
  const agePts = age === null ? 15 : age < 180 ? 20 : age < 365 ? 10 : age < 1095 ? 5 : 0;
  const g = p.change_7d;
  const growth = g === null ? 5 : g < -20 ? 15 : g < -10 ? 10 : g < 0 ? 5 : 0;
  const catTvl = medians.tvlByCategory.get(p.category ?? '') ?? null;
  let size = 0;
  if (p.tvl_usd < 100_000_000) size += 10;
  if (catTvl !== null && p.tvl_usd < catTvl) size += 5;
  size = Math.min(size, 10);
  const n = peerCountFor(p, table);
  const peers = n < 3 ? 10 : n < 5 ? 5 : 0;
  const execution = executionRisk(p).points;
  return { concentration, age: agePts, growth, size, peers, execution };
}

/** The risk score: the six components summed, capped at 100. */
export function riskScore(parts: RiskParts): number {
  return Math.min(100, parts.concentration + parts.age + parts.growth + parts.size + parts.peers + parts.execution);
}

/** The risk tier a score falls in. */
export function riskTier(score: number): RiskTier {
  if (score < 25) return 'Low';
  if (score < 50) return 'Moderate';
  if (score < 70) return 'High';
  return 'Very high';
}

/** The launch-readiness tier from age, TVL and growth alone. */
export function readinessTier(p: SnapshotProtocol, age: number | null, floorUsd: number): ReadinessTier {
  const g = p.change_7d ?? 0;
  if (age !== null && age >= 365 && p.tvl_usd >= floorUsd && g >= 0) return 'Ready';
  if ((age !== null && age >= 180 && p.tvl_usd >= 100_000_000) || p.tvl_usd >= floorUsd) return 'Watching';
  return 'Early';
}

/** The scored value of one protocol under the model, with every multiplier that produced it. */
export interface Scored {
  impliedRaw: number;
  implied: number;
  peerMultiple: number;
  peerN: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainFactorValue: number;
  age: number | null;
  riskParts: RiskParts;
  riskScore: number;
  riskTier: RiskTier;
  readiness: ReadinessTier;
  momentumPct: number | null;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  table: PeerTable,
  medians: CategoryMedians,
  floorUsd: number,
  model: ModelConstants = MODEL,
): Scored {
  const age = ageDays(asOf, p.listed_at);
  const peerMultiple = peerMultipleFor(p, table);
  const peerN = peerCountFor(p, table);
  const { pct, mult } = growthMultiplier(p, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainFactorValue = chainFactor(p, model);
  const parts = riskParts(p, age, medians, table);
  const score = riskScore(parts);
  const tier = riskTier(score);
  const readiness = readinessTier(p, age, floorUsd);
  const catChange = medians.changeByCategory.get(p.category ?? '') ?? null;
  const momentumPct = p.change_7d === null || catChange === null ? null : round4(p.change_7d - catChange);
  const impliedRaw = Math.max(1, Math.round(p.tvl_usd * peerMultiple * mult * maturityMult * chainFactorValue));
  const discount = score * model.risk_discount_per_point;
  const implied = Math.max(1, Math.round(impliedRaw * (1 - discount)));
  return { impliedRaw, implied, peerMultiple, peerN, growthPct: pct, growthMult: mult, maturityMult, chainFactorValue, age, riskParts: parts, riskScore: score, riskTier: tier, readiness, momentumPct };
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

/** Whether a protocol is one the board may rank: pre-token and passing the exclusion rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcludedByWatchlistRule(p);
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A small deterministic pick from a list, from a slug's own characters: the same slug always
 * picks the same variant, and no slug is ever special-cased. */
function pick<T>(slug: string, options: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return options[h % options.length]!;
}

/* ------------------------------------------------------------------ farm plans */

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
  if (c.includes('sui') || c.includes('aptos') || c.includes('cosmos') || c.includes('injective')) return 'about $0.05 of gas';
  if (c.includes('bitcoin') || c.includes('btc')) return 'about $1-3 of network fees';
  return 'about $0.10-1 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
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

/** One category's farm actions: the qualifying action, a second action, and the weekly cadence.
 * Each list holds two or three wordings; the protocol's slug picks one deterministically, so two
 * protocols in one category still read differently. {name}, {capital} and {chain} are filled in
 * from the protocol's own record. */
interface ActionBank {
  action: readonly string[];
  second: readonly string[];
  weekly: readonly string[];
}

const ACTION_BANKS: ReadonlyArray<readonly [string, ActionBank]> = [
  ['risk curator', {
    action: [
      'Deposit ${capital} of USDC into a {name} curator vault on {chain} and keep the vault shares.',
      'Allocate ${capital} of USDC across two {name} curator vaults on {chain} and hold both positions.',
      'Supply ${capital} of USDC to the {name} curated vault on {chain} with the lowest fee tier.',
    ],
    second: [
      'Read the curator allocation for the vault and check which underlying markets it lends into.',
      'Compare the vault APY on {name} with the same strategy run directly, and note the fee difference.',
      'Move half the position to a second {name} vault with a different risk profile.',
    ],
    weekly: ['rebalance between the curator vaults or top up the smaller one'],
  }],
  ['onchain capital allocator', {
    action: [
      'Deposit ${capital} of USDC into a {name} allocator vault on {chain} and keep the shares.',
      'Allocate ${capital} across the {name} strategies on {chain} and hold the allocation for the full window.',
      'Supply ${capital} of USDC to {name} on {chain} and let the allocator route it.',
    ],
    second: [
      'Open the allocator dashboard and check where the ${capital} of capital is currently deployed.',
      'Read the allocator fee schedule and the withdrawal delay before adding more.',
      'Shift a slice of the allocation to the strategy with the longest track record.',
    ],
    weekly: ['check the allocation and rebalance toward the best-performing strategy'],
  }],
  ['dex', {
    action: [
      'Provide ${capital} of liquidity to {name}\u2019s main pool on {chain} and keep the position open.',
      'Swap ${capital} of USDC for the pool\u2019s other asset on {name} on {chain}, then provide both sides as liquidity.',
      'Open a concentrated liquidity position worth ${capital} around the current price on {name} on {chain}.',
    ],
    second: [
      'Check the pool\u2019s fee tier and the impermanent loss on the position so far.',
      'Swap a small amount through the pool and compare the quoted price with the executed price.',
      'Collect the trading fees the position earned and re-add them to the pool.',
    ],
    weekly: ['swap a small amount, collect fees, or rebalance the range'],
  }],
  ['lend', {
    action: [
      'Supply ${capital} of USDC to {name} on {chain} and keep the position open.',
      'Deposit ${capital} of USDC as collateral on {name} on {chain} and borrow a small amount against it.',
      'Supply ${capital} of USDC to the {name} lending market on {chain} and enable it as collateral.',
    ],
    second: [
      'Check the health factor of the position and the borrow rate on {name}.',
      'Repay a little of the borrowed amount, or add a little more collateral, and watch the rate move.',
      'Compare the supply APY on {name} with the same asset lent elsewhere.',
    ],
    weekly: ['add a small deposit, borrow a little, or repay a little'],
  }],
  ['cdp', {
    action: [
      'Lock ${capital} of collateral in a {name} vault on {chain} and mint a small amount of the stable asset.',
      'Open a {name} collateralized position on {chain} with ${capital} of collateral and keep the ratio safe.',
      'Deposit ${capital} of collateral into {name} on {chain} and mint against it at a low ratio.',
    ],
    second: [
      'Check the collateralization ratio and the liquidation price of the vault.',
      'Repay part of the minted amount to lift the ratio further from liquidation.',
      'Read the stability fee and the redemption terms before minting more.',
    ],
    weekly: ['top up the collateral, repay a little, or check the ratio'],
  }],
  ['yield aggregator', {
    action: [
      'Deposit ${capital} into a {name} vault on {chain} and keep the shares.',
      'Allocate ${capital} across two {name} vaults on {chain} with different underlying strategies.',
      'Supply ${capital} to the {name} auto-compounding vault on {chain} and leave the rewards to compound.',
    ],
    second: [
      'Check which underlying strategies the vault routes into and what they pay.',
      'Harvest the vault rewards once and re-deposit them instead of withdrawing.',
      'Compare the vault\u2019s net APY after fees with the same strategy run by hand.',
    ],
    weekly: ['harvest once, top up the vault, or check the net APY'],
  }],
  ['yield', {
    action: [
      'Deposit ${capital} into a {name} vault on {chain} and keep the shares.',
      'Stake ${capital} into the {name} yield vault on {chain} and hold the receipt token.',
      'Supply ${capital} to {name} on {chain} and let the yield accrue in the position.',
    ],
    second: [
      'Check the source of the yield: trading fees, lending interest, or incentives.',
      'Claim the accrued yield once and re-deposit it to compound.',
      'Compare the yield on {name} with the same asset held elsewhere.',
    ],
    weekly: ['claim and re-deposit the yield, or top up the position'],
  }],
  ['rwa', {
    action: [
      'Mint ${capital} of the protocol\u2019s yield-bearing asset on {chain} and hold it.',
      'Buy ${capital} of the tokenized asset through {name} on {chain} and keep it in the farm wallet.',
      'Subscribe ${capital} to the {name} offering on {chain} and hold the receipt.',
    ],
    second: [
      'Read the backing documents and the redemption terms for the asset.',
      'Check the asset\u2019s on-chain supply against the issuer\u2019s published backing.',
      'Verify the redemption window and any lock-up before adding more.',
    ],
    weekly: ['check the yield accrual and the backing report'],
  }],
  ['derivative', {
    action: [
      'Deposit ${capital} of USDC as margin on {name} and open one small hedge.',
      'Open a small perpetual position worth ${capital} on {name} on {chain} with low leverage.',
      'Deposit ${capital} of collateral on {name} on {chain} and place one limit order.',
    ],
    second: [
      'Check the funding rate and the liquidation price of the open position.',
      'Close half the position and note the realized fee and slippage.',
      'Read the mark price against the index price before placing the next order.',
    ],
    weekly: ['adjust the hedge or open one small trade'],
  }],
  ['perpetual', {
    action: [
      'Deposit ${capital} of USDC as margin on {name} and open one small hedge.',
      'Open a small perpetual position worth ${capital} on {name} on {chain} with low leverage.',
      'Fund a {name} margin account on {chain} with ${capital} and place one limit order.',
    ],
    second: [
      'Check the funding rate and the liquidation price of the open position.',
      'Close half the position and note the realized fee and slippage.',
      'Read the mark price against the index price before placing the next order.',
    ],
    weekly: ['adjust the hedge or open one small trade'],
  }],
  ['basis', {
    action: [
      'Deposit ${capital} into {name}\u2019s basis vault on {chain} and keep the position open.',
      'Allocate ${capital} to the {name} basis trade on {chain} and hold the vault shares.',
      'Supply ${capital} to {name} on {chain} and let the basis position run.',
    ],
    second: [
      'Check the funding rate the basis trade is earning and whether it flipped negative.',
      'Read the vault\u2019s hedge: spot long against the short, and where each leg sits.',
      'Compare the basis yield with the plain funding rate on the same venue.',
    ],
    weekly: ['check the funding rate and the hedge ratio'],
  }],
  ['staking pool', {
    action: [
      'Stake ${capital} of the chain\u2019s staking asset through {name} and keep the receipt token.',
      'Delegate ${capital} through the {name} staking pool on {chain} and hold the receipt.',
      'Stake ${capital} with {name} on {chain} and keep the liquid staking receipt.',
    ],
    second: [
      'Check the receipt token\u2019s price against the staked asset and the unstaking delay.',
      'Use the receipt token in a second protocol once, then return it to the pool.',
      'Compare the pool\u2019s commission with other staking pools on the same chain.',
    ],
    weekly: ['top up the stake or claim the staking rewards'],
  }],
  ['restak', {
    action: [
      'Restake ${capital} of the receipt token through {name} on {chain} and keep the receipt.',
      'Deposit ${capital} of the liquid staking receipt into {name} on {chain} and hold the restaked position.',
      'Allocate ${capital} to a {name} restaking vault on {chain} and keep the shares.',
    ],
    second: [
      'Check which operators and services the restaked position secures.',
      'Read the slashing terms and the withdrawal delay before adding more.',
      'Compare the restaking yield with the plain staking yield on the same asset.',
    ],
    weekly: ['top up the stake or claim the restaking rewards'],
  }],
  ['prediction', {
    action: [
      'Fund ${capital} and place one market position on {name}.',
      'Buy ${capital} of shares in one {name} market on {chain} and hold them to resolution.',
      'Place ${capital} across two {name} markets on {chain} on opposite outcomes.',
    ],
    second: [
      'Read the market\u2019s resolution source and the trading fee before placing more.',
      'Check the order book depth and the spread on the market you hold.',
      'Close the position early once and compare the exit price with the entry.',
    ],
    weekly: ['place one small market position or settle one market'],
  }],
  ['insurance', {
    action: [
      'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
      'Purchase ${capital} of coverage through {name} on {chain} for the farm position.',
      'Open a {name} policy on {chain} worth ${capital} and hold it for the farm window.',
    ],
    second: [
      'Read the policy\u2019s exclusions and the claims process before adding cover.',
      'Check the cover\u2019s expiry and the premium against the risk it covers.',
      'File a test claim inquiry to see what proof the process asks for.',
    ],
    weekly: ['renew the cover or check the policy status'],
  }],
  ['payment', {
    action: [
      'Spend ${capital} through {name} on {chain} and keep the receipt.',
      'Route ${capital} of payments through {name} on {chain} and hold the receipts.',
      'Use {name} on {chain} to settle ${capital} and keep the transaction record.',
    ],
    second: [
      'Check the settlement time and the fee on the payment you made.',
      'Compare the fee with the same payment sent directly on chain.',
      'Keep the receipts in the farm log for the next step.',
    ],
    weekly: ['make a payment or check the settlement record'],
  }],
  ['farm', {
    action: [
      'Deposit ${capital} into a {name} farm on {chain} and keep the position open.',
      'Stake ${capital} in the {name} farm on {chain} and hold the receipt.',
      'Supply ${capital} to {name} on {chain} and let the farm rewards accrue.',
    ],
    second: [
      'Check the farm\u2019s reward rate and the emission schedule.',
      'Harvest the farm rewards once and re-stake them.',
      'Compare the farm APY with the same tokens staked elsewhere.',
    ],
    weekly: ['harvest once or top up the farm'],
  }],
  ['leveraged farm', {
    action: [
      'Open a leveraged farm position worth ${capital} on {name} on {chain} with low leverage.',
      'Deposit ${capital} into a {name} leveraged vault on {chain} and keep the leverage low.',
      'Supply ${capital} to {name} on {chain} and borrow a small amount to lever the farm.',
    ],
    second: [
      'Check the leverage ratio and the liquidation price of the farm position.',
      'Reduce the leverage by repaying part of the borrowed amount.',
      'Read the borrow rate and the farm APY side by side.',
    ],
    weekly: ['check the leverage ratio and the borrow rate'],
  }],
  ['index', {
    action: [
      'Buy ${capital} of the {name} index on {chain} and hold it.',
      'Mint ${capital} of the {name} index token on {chain} and keep it.',
      'Allocate ${capital} to the {name} basket on {chain} and hold the index token.',
    ],
    second: [
      'Check the index composition and the weight of its largest holding.',
      'Compare the index price with the value of its underlying holdings.',
      'Read the rebalancing schedule and the fee before adding more.',
    ],
    weekly: ['check the index composition or top up the position'],
  }],
  ['chain', {
    action: [
      'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app.',
      'Deposit ${capital} into {name} on {chain} and use the chain\u2019s own app once.',
      'Supply ${capital} to the {name} deployment on {chain} and keep the position open.',
    ],
    second: [
      'Check the bridge or deployment status on the chain\u2019s own explorer.',
      'Use one native app on {chain} with the bridged funds.',
      'Compare the fee on {chain} with the same action on Ethereum.',
    ],
    weekly: ['bridge a small amount or use one native app'],
  }],
];

/** The bank for a category: the most specific keyword wins, else a plain deposit. */
function bankFor(p: SnapshotProtocol): ActionBank {
  const c = (p.category ?? '').toLowerCase();
  for (const [key, bank] of ACTION_BANKS) {
    if (c.includes(key)) return bank;
  }
  return {
    action: [
      'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
      'Supply ${capital} of USDC to {name} on {chain} and hold the position.',
    ],
    second: [
      'Open the protocol\u2019s own dashboard and check the position and its rewards.',
      'Read the protocol\u2019s fee schedule and the withdrawal terms before adding more.',
    ],
    weekly: ['make a deposit, a swap, or a vote'],
  };
}

/** Fill a template's {name}, {capital} and {chain} from the protocol's own record. */
function fill(template: string, p: SnapshotProtocol, capital: number, chain: string): string {
  return template.replaceAll('{name}', p.name).replaceAll('{capital}', String(capital)).replaceAll('{chain}', chain);
}

/** The wallet-setup step: three wordings, picked by the slug, so the opening step is not the
 * same sentence on all two hundred rows. */
function walletStep(p: SnapshotProtocol): FarmStep {
  const variants: readonly string[] = [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.',
    'Open a new wallet only for this farm, fund it with the farming amount, and store its seed phrase offline.',
    'Set aside one wallet for {name} alone, keep its seed phrase on paper, and fund it with the amount below.',
  ];
  return { text: fill(pick(p.slug, variants), p, 0, ''), cost: 'nothing to open, and the first transaction\u2019s gas', time: '5 minutes' };
}

/** The risk step: the protocol's largest risk component, stated as a check with its own numbers. */
function riskStep(p: SnapshotProtocol, s: Scored): FarmStep {
  const parts = s.riskParts;
  const entries: ReadonlyArray<readonly [number, string, string, string]> = [
    [parts.concentration, 'single-chain concentration', 'This protocol runs on one chain only, so a problem on that chain reaches the whole position: keep this farm smaller than a multi-chain one.', '5 minutes to check'],
    [parts.age, 'short track record', `This protocol was first listed ${s.age === null ? 'recently' : `${s.age} days ago`}, so its record is short: farm with the smaller capital tier and re-check the listing before adding more.`, '5 minutes to check'],
    [parts.growth, 'shrinking TVL', `TVL fell ${Math.abs(s.growthPct)}% in the last seven days, so the protocol is shrinking while you farm it: watch the TVL weekly and unwind if the fall continues.`, '5 minutes a week'],
    [parts.size, 'small size', `TVL of ${fmtTvlShort(p.tvl_usd)} is small for its category, so a single large withdrawal moves it: keep the position small and exit in slices.`, '5 minutes to check'],
    [parts.peers, 'thin live pricing', `Only ${s.peerN} live protocols priced this category, so the implied value rests on thin evidence: treat the figure as a rough range, not a price.`, '5 minutes to check'],
    [parts.execution, 'execution risk', `${executionRisk(p).note}`, '5 minutes to check'],
  ];
  let best = entries[0]!;
  for (const e of entries) if (e[0] > best[0]) best = e;
  const label = best[0] === 0 ? 'general risk' : best[1];
  const text = best[0] === 0
    ? 'This protocol\u2019s record is steady on every risk the model checks: still farm only with funds you can afford to leave locked, and verify each step on the protocol\u2019s own pages.'
    : `Risk check (${label}): ${best[2]}`;
  return { text, cost: 'nothing but the check', time: best[3] };
}

/** A short TVL for a sentence. */
function fmtTvlShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age, risk) and nothing else. The qualifying
 * action, the second action and the weekly cadence come from the category's own bank; the risk
 * step names the protocol's largest risk component with its own numbers; the hold window follows
 * its age. Two protocols in one category still read differently: the slug picks the wording.
 */
export function farmSteps(p: SnapshotProtocol, s: Scored): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(s.age);
  const bank = bankFor(p);
  const action = fill(pick(p.slug, bank.action), p, capital, chain);
  const second = fill(pick(`${p.slug}/2`, bank.second), p, capital, chain);
  const weekly = fill(pick(`${p.slug}/w`, bank.weekly), p, capital, chain);
  return [
    walletStep(p),
    { text: action, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: second, cost: `${gas} for the check`, time: '10 minutes' },
    { text: `Do one qualifying action each week, such as ${weekly}, so the wallet shows steady activity.`, cost: `${gas} a week`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    riskStep(p, s),
    { text: `Before you withdraw, open ${p.name}\u2019s own points or rewards page from its official site and claim only from the link it publishes, and never pay anyone to claim for you.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position or unwind it later.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** One step as a single string: action, cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/* ------------------------------------------------------------------ the board */

/** The board: the watchlist plus every other rankable pre-token protocol, strongest first by
 * risk-adjusted implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = peerTable(snapshot, model);
  const medians = categoryMedians(snapshot);
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

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, table, medians, snapshot.floor_usd, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.s.impliedRaw - a.s.impliedRaw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    implied_raw_usd: s.impliedRaw,
    risk_score: s.riskScore,
    risk_tier: s.riskTier,
    readiness: s.readiness,
    momentum_pct: s.momentumPct,
    capital_usd: capitalFor(p),
    peer_n: s.peerN,
    model: {
      peer_multiple: s.peerMultiple,
      peer_n: s.peerN,
      growth_pct: round4(s.growthPct),
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_factor: s.chainFactorValue,
      age_days: s.age,
      risk_score: s.riskScore,
      risk_parts: s.riskParts,
      momentum_pct: s.momentumPct,
      readiness: s.readiness,
    },
    farm_steps: farmSteps(p, s).map(stepText),
  }));
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

/** One category's live pricing, for the dashboard's Live panel: the multiple the market pays
 * there, how many live protocols priced it, and the category's median 7-day change and pre-token
 * TVL. Categories are ordered by live peer count, most priced first. */
export function categoryStats(snapshot: Snapshot, table: PeerTable, medians: CategoryMedians): CategoryStat[] {
  const out: CategoryStat[] = [];
  for (const [category, entry] of table.byCategory) {
    out.push({
      category,
      multiple: entry.multiple,
      n: entry.n,
      median_change_7d: medians.changeByCategory.get(category) ?? null,
      median_tvl_usd: medians.tvlByCategory.get(category) ?? 0,
    });
  }
  out.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return out;
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
    implied_raw_usd: row.implied_raw_usd,
    risk_score: row.risk_score,
    risk_tier: row.risk_tier,
    readiness: row.readiness,
    momentum_pct: row.momentum_pct,
    capital_usd: row.capital_usd,
    peer_n: row.peer_n,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_factor: row.model.chain_factor,
    risk_parts: row.model.risk_parts,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = peerTable(snapshot, model);
  const medians = categoryMedians(snapshot);
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
    categories: categoryStats(snapshot, table, medians),
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not JSON object');
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
