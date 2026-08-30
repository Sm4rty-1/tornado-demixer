/**
 * The signals.
 *
 * Each one looks at a single (deposit, candidate withdrawal) pair and answers
 * one question, in [0, 1], or returns null for "this signal cannot speak here".
 * Returning null matters as much as scoring: a relayed withdrawal's gas price
 * belongs to the relayer, so any gas-shaped question about it is unanswerable,
 * not answered "no". The previous version of this tool scored those pairs
 * anyway and quietly filtered out real candidates because a stranger's wallet
 * happened to use a different fee.
 *
 * Each signal carries a likelihood ratio: how much more often it fires on a
 * genuinely linked pair than on an unrelated one. They are combined by
 * multiplying odds, starting from the honest prior — one over the size of the
 * anonymity set. See `combine` at the bottom for why that is the only framing
 * that survives contact with a big pool.
 *
 * The ratios are judgement calls, informed by the published work on Tornado
 * heuristics rather than measured here. They are deliberately conservative, and
 * they are constants in one place precisely so a reader can disagree with a
 * number and re-run.
 */

import { COMMON_CONTRACTS, COMMON_TOKENS, PROTOCOL_ADDRESSES } from "./constants.js";
import { sameAddress } from "./hex.js";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Anything at or above this is quoted as a confirmed link, not a lead. */
export const DECISIVE = 1;

/**
 * A withdrawal is "self-relayed" when the user paid their own gas: no relayer
 * fee, or the relayer is the recipient. Only then does the withdrawal
 * transaction carry the *user's* wallet fingerprint.
 */
export function isSelfRelayed(candidate) {
  if (candidate.fee === 0n) return true;
  if (!candidate.relayer) return true;
  if (/^0x0{40}$/.test(candidate.relayer)) return true;
  return sameAddress(candidate.relayer, candidate.recipient);
}

/** Circular distance between two hours of day, 0-12. */
function hourDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 - raw);
}

/**
 * Round numbers are what wallets suggest, so two txs agreeing on 1.5 gwei says
 * much less than two agreeing on 1.437291 gwei. Scales a gas match by how
 * unusual the shared value is.
 */
function unusualness(weiPerGas) {
  const gwei = Number(weiPerGas) / 1e9;
  if (!Number.isFinite(gwei) || gwei === 0) return 0.5;
  const roundedToTenth = Math.abs(gwei - Math.round(gwei * 10) / 10) < 1e-9;
  const roundedToWhole = Math.abs(gwei - Math.round(gwei)) < 1e-9;
  if (roundedToWhole) return 0.45;
  if (roundedToTenth) return 0.7;
  return 1;
}

/**
 * Compare what the depositor put in against what one address took out.
 *
 * `covered` is how many of the depositor's notes this address could account
 * for; `excess` is how many notes it holds that the depositor never deposited,
 * counting denominations they never touched as entirely excess. The two are
 * deliberately separate: a shortfall means the money went somewhere else too,
 * while an excess means somebody else's money arrived here.
 */
export function compareDenominations(wanted, got) {
  let covered = 0;
  let wantedTotal = 0;
  let excess = 0;
  const parts = [];
  const excessParts = [];

  for (const [poolId, count] of wanted) {
    const received = got.get(poolId) ?? 0;
    wantedTotal += count;
    covered += Math.min(received, count);
    if (received > count) {
      excess += received - count;
      excessParts.push(`${received - count} extra ${poolId}`);
    }
    parts.push(`${poolId}: deposited ${count}, received ${received}`);
  }

  // Denominations the depositor never used at all are excess in full.
  for (const [poolId, received] of got) {
    if (wanted.has(poolId)) continue;
    excess += received;
    excessParts.push(`${received} × ${poolId}, never deposited`);
    parts.push(`${poolId}: deposited 0, received ${received}`);
  }

  return {
    covered,
    wantedTotal,
    excess,
    parts,
    detailByPool: excessParts.join("; "),
  };
}

export const SIGNALS = [
  {
    id: "address-reuse",
    label: "Address reuse",
    group: "core",
    weight: 6,
    // Not really a ratio: withdrawing to the depositing address is the link,
    // not evidence of it. Large enough to swamp any prior.
    lr: 1e6,
    decisive: true,
    question: "Did the money come back to the address that sent it in?",
    evaluate(ctx, candidate) {
      if (sameAddress(candidate.recipient, ctx.deposit.depositor)) {
        return {
          score: 1,
          detail: "Withdrawal recipient is the depositor address itself.",
        };
      }
      return { score: 0, detail: "Recipient is a different address." };
    },
  },

  {
    id: "counterparty",
    label: "Known counterparty",
    group: "core",
    weight: 5,
    // Two addresses that already know each other, on both ends of a mixer, is
    // hard to get by chance — but funding relationships and exchange hot
    // wallets do produce it, so this is not decisive on its own.
    lr: 150,
    question: "Has the depositor ever transacted with this recipient directly?",
    evaluate(ctx, candidate) {
      const counterparties = ctx.depositor.counterparties;
      if (!counterparties) return null; // No transaction history available.
      if (counterparties.has(candidate.recipient)) {
        return {
          score: 1,
          detail: "Depositor has transacted with this address outside Tornado.",
        };
      }
      return { score: 0, detail: "No direct history between the two addresses." };
    },
  },

  {
    id: "multi-denomination",
    label: "Denomination profile",
    group: "core",
    weight: 5,
    // Matching a multi-pool fingerprint (say 3 × 1 ETH and 1 × 10 ETH) is the
    // strongest behavioural signal there is short of address reuse — but only
    // when the match is exact. Tutela's version of this heuristic requires the
    // withdrawing address to withdraw *identically*, and it is right to: a
    // recipient holding more notes than went in received some of them from
    // somebody else, which makes it a worse answer to "where did this
    // depositor's money go", not a better one.
    lr: 80,
    question:
      "Did one address receive the same mix of denominations the depositor put in?",
    evaluate(ctx, candidate) {
      const wanted = ctx.depositor.denominationCounts;
      // Only interesting once the fingerprint has shape: one pool is not a profile.
      if (!wanted || wanted.size < 2) return null;

      const got = ctx.recipientTotals.get(candidate.recipient);
      if (!got) return { score: 0, detail: "Recipient received nothing else in the window." };

      const { covered, wantedTotal, excess, parts } = compareDenominations(wanted, got);
      if (wantedTotal === 0) return null;

      // Two separate questions. How much of the depositor's set does this
      // address account for, and how much of what it holds is unaccounted for?
      const coverage = covered / wantedTotal;
      const exactness = 1 - excess / (wantedTotal + excess);
      const score = coverage * exactness;

      const summary = parts.join("; ");
      return {
        score,
        detail:
          excess === 0
            ? coverage === 1
              ? `Recipient received exactly the depositor's denomination fingerprint (${summary}).`
              : `Partial denomination overlap, nothing extra (${summary}).`
            : `Overlap with ${excess} withdrawal${excess === 1 ? "" : "s"} the depositor never deposited (${summary}).`,
      };
    },
  },

  {
    id: "denomination-excess",
    label: "Unaccounted withdrawals",
    group: "core",
    weight: 4,
    // Below 1: this signal argues *against* a candidate. Every note an address
    // holds beyond what the depositor put in came from someone else, which
    // means the address is shared — a consolidation point, an exchange deposit
    // address, or simply not the person we are looking for.
    //
    // Not a hard exclusion, deliberately. The depositor may well have made the
    // extra deposit outside the history we can read, which is why the penalty
    // is softened when we know the history was truncated, and why the strict
    // version of this lives behind a filter the analyst turns on.
    lr: 0.12,
    question: "Does this address hold more notes than the depositor deposited?",
    evaluate(ctx, candidate) {
      const wanted = ctx.depositor.denominationCounts;
      const got = ctx.recipientTotals.get(candidate.recipient);
      if (!wanted || wanted.size === 0 || !got) return null;

      const { excess, wantedTotal, detailByPool } = compareDenominations(wanted, got);
      if (wantedTotal === 0) return null;
      if (excess === 0) {
        return { score: 0, detail: "Everything this address received is accounted for." };
      }

      // Three unexplained notes is as bad as thirty for our purposes: the
      // address is shared either way.
      let score = Math.min(1, excess / 3);

      if (ctx.depositor.historyComplete === false) {
        // We could not read the depositor's whole history, so some of this
        // "excess" may be theirs. Halve the objection rather than make it.
        score *= 0.5;
        return {
          score,
          detail: `${excess} withdrawal${excess === 1 ? "" : "s"} more than the depositor is known to have deposited (${detailByPool}) — discounted, because their history was truncated.`,
        };
      }

      return {
        score,
        detail: `${excess} withdrawal${excess === 1 ? "" : "s"} the depositor never deposited (${detailByPool}). Something else funded them.`,
      };
    },
  },

  {
    id: "deposit-count",
    label: "Deposit count match",
    group: "core",
    weight: 4,
    lr: 25,
    question:
      "The depositor made N deposits of one size — did one address collect exactly N of that size?",
    evaluate(ctx, candidate) {
      const session = ctx.depositor.session;
      // A single deposit has no count to match; every recipient would "match" 1.
      if (!session || session.deposits < 2) return null;

      const received = ctx.recipientTotals.get(candidate.recipient)?.get(ctx.deposit.pool.id) ?? 0;
      if (received === 0) return { score: 0, detail: "No withdrawals of this size to this address." };

      const denomination = `${ctx.deposit.pool.denomination} ${ctx.deposit.pool.asset}`;
      if (received === session.deposits) {
        return {
          score: 1,
          detail: `Depositor made ${session.deposits} deposits of ${denomination}; this address received exactly ${received}.`,
        };
      }

      // Taking fewer is ordinary — the rest went to another wallet, which is
      // the whole reason split exits exist. Taking more is not: those notes
      // came from somebody else, and `denomination-excess` prices that in.
      if (received < session.deposits) {
        return {
          score: received / session.deposits,
          detail: `Depositor made ${session.deposits} deposits of ${denomination}; this address received ${received}. The rest may have gone elsewhere.`,
        };
      }

      return {
        score: Math.max(0, session.deposits / received),
        detail: `Depositor made ${session.deposits} deposits of ${denomination}, but this address received ${received} — more than went in.`,
      };
    },
  },

  {
    id: "gas-price",
    label: "Gas price fingerprint",
    group: "core",
    weight: 4,
    // An identical, unusual gas price on a self-relayed withdrawal is close to
    // a wallet signature. Scaled down inside evaluate() when the shared value
    // is a round number a wallet would have suggested anyway.
    lr: 120,
    question: "Did both transactions bid an identical, unusual gas price?",
    evaluate(ctx, candidate) {
      // A relayer paid this gas, so it fingerprints the relayer, not the user.
      if (!isSelfRelayed(candidate)) return null;
      const depositGas = ctx.deposit.tx?.gasPrice;
      if (!depositGas || !candidate.gasPrice) return null;

      if (depositGas === candidate.gasPrice) {
        return {
          score: unusualness(depositGas),
          detail: `Identical effective gas price on both sides (${Number(depositGas) / 1e9} gwei).`,
        };
      }

      // Near-misses are worth something: base fee moves between blocks even when
      // the wallet's priority-fee setting does not.
      const ratio = Number(depositGas) / Number(candidate.gasPrice);
      if (ratio > 0.99 && ratio < 1.01) {
        return { score: 0.35, detail: "Gas prices within 1% of each other." };
      }
      return { score: 0, detail: "Gas prices differ." };
    },
  },

  {
    id: "priority-fee",
    label: "Priority fee fingerprint",
    group: "optional",
    weight: 3,
    lr: 20,
    question: "Did both transactions use the same priority-fee setting?",
    evaluate(ctx, candidate) {
      if (!isSelfRelayed(candidate)) return null;
      const want = ctx.deposit.tx?.maxPriorityFeePerGas;
      const got = candidate.tx?.maxPriorityFeePerGas;
      if (want == null || got == null) return null; // Needs the deep pass.

      if (want === got) {
        return {
          score: unusualness(want),
          detail: `Same maxPriorityFeePerGas (${Number(want) / 1e9} gwei) — a wallet-level setting.`,
        };
      }
      return { score: 0, detail: "Different priority-fee settings." };
    },
  },

  {
    id: "timing",
    label: "Timing proximity",
    group: "optional",
    weight: 3,
    // Withdrawing quickly is common among linked pairs and common in general.
    // A small ratio, applied to a lot of candidates.
    lr: 4,
    question: "How long did the money sit in the pool?",
    evaluate(ctx, candidate) {
      const delay = candidate.timestamp - ctx.deposit.timestamp;
      if (delay < 0) return null; // Filtered upstream, but never score a negative delay.

      // Decay with a 3-day half-life: hours after a deposit is a strong signal,
      // a month later is barely one. Users who wait are the ones who stay hidden.
      const score = Math.exp((-delay * Math.LN2) / (3 * DAY));
      return {
        score,
        detail: `Withdrawn ${formatDelay(delay)} after the deposit.`,
      };
    },
  },

  {
    id: "activity-window",
    label: "Time-of-day match",
    group: "optional",
    weight: 2,
    // People keep hours, but a two-hour window covers a sixth of the clock, so
    // roughly one candidate in six matches by chance.
    lr: 2.5,
    question: "Do both transactions fall in the same part of the depositor's day?",
    evaluate(ctx, candidate) {
      const depositHour = new Date(ctx.deposit.timestamp * 1000).getUTCHours();
      const withdrawHour = new Date(candidate.timestamp * 1000).getUTCHours();
      const distance = hourDistance(depositHour, withdrawHour);

      // Within two hours is the window the original tool used; scale down from there.
      const score = distance <= 2 ? 1 - distance / 6 : Math.max(0, 1 - distance / 8);
      return {
        score,
        detail: `Deposit at ${depositHour}:00 UTC, withdrawal at ${withdrawHour}:00 UTC (${distance}h apart in the day).`,
      };
    },
  },

  {
    id: "transaction-type",
    label: "Transaction type match",
    group: "optional",
    weight: 1,
    // Almost everything is type 2 now, so agreeing says almost nothing.
    lr: 1.3,
    question: "Are both transactions the same EIP-2718 type?",
    evaluate(ctx, candidate) {
      if (!isSelfRelayed(candidate)) return null;
      const want = ctx.deposit.tx?.type;
      const got = candidate.tx?.type;
      if (want == null || got == null) return null;
      return want === got
        ? { score: 1, detail: `Both type ${want}.` }
        : { score: 0, detail: `Type ${want} vs type ${got}.` };
    },
  },

  {
    id: "builder",
    label: "Same block builder",
    group: "optional",
    weight: 1,
    // Two builders win most blocks. Worth a nudge, never more.
    lr: 1.4,
    question: "Were both transactions included by the same builder?",
    evaluate(ctx, candidate) {
      const want = ctx.deposit.block?.miner;
      const got = candidate.block?.miner;
      if (!want || !got) return null; // Deep pass only.

      // Two or three builders win most blocks, so a match is common by chance.
      // It is only worth raising when the two transactions are close in time.
      const delay = candidate.timestamp - ctx.deposit.timestamp;
      if (delay > 1 * DAY) return null;

      return sameAddress(want, got)
        ? { score: 1, detail: `Both included by ${want}.` }
        : { score: 0, detail: "Different builders." };
    },
  },

  {
    id: "relayer-link",
    label: "Relayer overlap",
    group: "optional",
    weight: 2,
    lr: 6,
    question: "Has the depositor dealt with this relayer before?",
    evaluate(ctx, candidate) {
      if (!ctx.depositor.counterparties) return null;
      if (isSelfRelayed(candidate)) return null;
      if (!candidate.relayer || PROTOCOL_ADDRESSES.has(candidate.relayer)) return null;

      return ctx.depositor.counterparties.has(candidate.relayer)
        ? { score: 1, detail: `Depositor has transacted with relayer ${candidate.relayer}.` }
        : { score: 0, detail: "No prior contact with this relayer." };
    },
  },

  {
    id: "asset-round-trip",
    label: "Asset round trip",
    group: "core",
    weight: 4,
    // The shape of somebody using a mixer as a laundry cycle rather than as a
    // wallet: sell the position, wash the proceeds, buy it back. The pattern is
    // directional and ordered — out of a token before the deposit, back into
    // the same token after the withdrawal — which is what makes it worth more
    // than the observation that two addresses both touched DAI.
    lr: 30,
    question:
      "Did the depositor move out of a token before depositing, and this address move back into it afterwards?",
    evaluate(ctx, candidate) {
      const sold = ctx.depositor.tokensSentBefore;
      const bought = candidate.tokensReceivedAfter;
      if (!sold || !bought) return null; // Deep pass only.
      if (sold.size === 0 || bought.size === 0) {
        return { score: 0, detail: "No token movement on one side of the mixer." };
      }

      const matches = [];
      for (const [address, token] of sold) {
        const back = bought.get(address);
        if (!back) continue;
        matches.push({ symbol: token.symbol, common: COMMON_TOKENS.has(address) });
      }

      if (matches.length === 0) {
        return { score: 0, detail: "Nothing they sold beforehand came back afterwards." };
      }

      // A stablecoin round trip is a weaker coincidence than an obscure one:
      // plenty of people hold USDC on both sides of anything.
      const best = matches.reduce((strongest, match) => {
        const value = match.common ? 0.55 : 1;
        return value > strongest ? value : strongest;
      }, 0);
      const score = Math.min(1, best + 0.1 * (matches.length - 1));

      const names = matches.map((match) => match.symbol).join(", ");
      return {
        score,
        detail: `Depositor moved out of ${names} before depositing; this address moved back into ${matches.length === 1 ? "it" : "them"} after withdrawing.`,
      };
    },
  },

  {
    id: "protocol-overlap",
    label: "Protocol overlap",
    group: "optional",
    weight: 2,
    // Everyone uses Uniswap, so only contracts outside the common set count.
    // Even then this is a habit, not an identity: two traders in the same niche
    // protocol are not the same person.
    lr: 7,
    question: "Do both addresses use the same uncommon contracts?",
    evaluate(ctx, candidate) {
      const theirs = ctx.depositor.contractsUsed;
      const ours = candidate.contractsUsed;
      if (!theirs || !ours) return null; // Deep pass only.

      const shared = [...ours].filter(
        (address) =>
          theirs.has(address) &&
          !COMMON_CONTRACTS.has(address) &&
          !PROTOCOL_ADDRESSES.has(address),
      );

      if (shared.length === 0) {
        return { score: 0, detail: "No uncommon contracts in common." };
      }

      const score = Math.min(1, 0.6 + 0.2 * (shared.length - 1));
      return {
        score,
        detail: `Both addresses use ${shared.length} uncommon contract${shared.length === 1 ? "" : "s"} (${shared.slice(0, 2).join(", ")}${shared.length > 2 ? ", …" : ""}).`,
      };
    },
  },

  {
    id: "downstream",
    label: "Downstream convergence",
    group: "core",
    weight: 4,
    // The classic split-exit tell: several fresh addresses forwarding to one
    // place the depositor already uses.
    lr: 60,
    question: "Do the withdrawn funds move on to somewhere the depositor knows?",
    evaluate(ctx, candidate) {
      const onward = ctx.downstream?.get(candidate.recipient);
      if (!onward) return null; // Deep pass only.
      if (!ctx.depositor.counterparties) return null;

      const shared = [...onward].filter((address) => ctx.depositor.counterparties.has(address));
      if (shared.length > 0) {
        return {
          score: 1,
          detail: `Funds moved on to ${shared[0]}, an address the depositor also uses.`,
        };
      }
      return { score: 0, detail: "No shared destination found one hop out." };
    },
  },
];

/**
 * A search window as words. Windows are held in days as a float so sub-day
 * scans work, but "0.25 days" is not how anyone thinks about it.
 */
export function formatWindow(days) {
  if (days < 1) {
    const hours = days * 24;
    const rounded = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
    return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
  }
  const rounded = Number.isInteger(days) ? days : Number(days.toFixed(1));
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

export function formatDelay(seconds) {
  if (seconds < HOUR) return `${Math.round(seconds / 60)} min`;
  if (seconds < DAY) return `${(seconds / HOUR).toFixed(1)} h`;
  return `${(seconds / DAY).toFixed(1)} days`;
}

/**
 * Combine the signals that could speak into one number.
 *
 * The obvious approach — average the signals — is wrong in a way that matters,
 * and the first version of this tool got it wrong. Most users do not withdraw
 * to the address they deposited from, so the highest-weighted signal scores
 * zero for nearly every real candidate, and averaging drags every honest lead
 * down towards nothing. Absence of the strongest evidence is the normal case,
 * not evidence of absence.
 *
 * So instead: start from the prior that this deposit is any one of the N
 * withdrawals in its anonymity set (odds 1/(N-1)), and let each signal that
 * fires multiply those odds by its likelihood ratio, raised to how strongly it
 * fired. A signal that does not fire multiplies by one and changes nothing.
 *
 * The output is a probability in the model's own terms, which is not the same
 * as being right. Its value is comparative: it says this candidate is worth
 * looking at before that one, and it says by how much.
 */
export function combine(ctx, candidate, { signals = SIGNALS, anonymitySet = 2, enabled = null } = {}) {
  // A disabled signal is not "unanswerable" — it is a question the analyst
  // chose not to ask, so it drops out of coverage as well as out of the odds.
  const active = enabled ? signals.filter((signal) => enabled.has(signal.id)) : signals;
  const evidence = [];
  const priorOdds = 1 / Math.max(1, anonymitySet - 1);
  let odds = priorOdds;
  let applicableWeight = 0;
  let totalWeight = 0;
  let decisive = false;

  for (const signal of active) {
    totalWeight += signal.weight;
    const result = signal.evaluate(ctx, candidate);
    if (!result) {
      evidence.push({ id: signal.id, label: signal.label, score: null, detail: "Not applicable." });
      continue;
    }

    applicableWeight += signal.weight;
    if (signal.decisive && result.score >= DECISIVE) decisive = true;

    // LR^score: no effect at 0, the full ratio at 1, and a sensible curve in
    // between for the signals that answer in degrees rather than yes/no.
    const contribution = signal.lr ** result.score;
    odds *= contribution;

    evidence.push({
      id: signal.id,
      label: signal.label,
      weight: signal.weight,
      lr: signal.lr,
      score: result.score,
      // What this signal alone did to the odds, so a reader can audit the sum.
      multiplier: contribution,
      detail: result.detail,
    });
  }

  return {
    // Evidence strength on its own, with no prior folded in: the product of
    // every multiplier above. 1 means the behaviour said nothing at all.
    // `normalise` turns a set of these into probabilities.
    weight: odds / priorOdds,
    standalone: odds / (1 + odds),
    priorProbability: priorOdds / (1 + priorOdds),
    decisive,
    coverage: totalWeight > 0 ? applicableWeight / totalWeight : 0,
    evidence,
  };
}

/**
 * Turn a set of scored candidates into probabilities that add up.
 *
 * Candidates are not independent claims, they are competing ones: the pool
 * released N withdrawals, and only a few of them can be this depositor's. Score
 * each one alone and you get the nonsense of four addresses at 90% — four
 * confident answers to a question with one answer.
 *
 * So the evidence weights are normalised across the whole candidate set to sum
 * to the number of withdrawals the depositor is actually expected to have made
 * (their session size — three deposits means three withdrawals to find). With
 * no evidence at all, every candidate lands exactly on the prior, 1/N, which is
 * the right answer for a pool nobody made a mistake in.
 *
 * The number this produces answers "does this withdrawal belong to the
 * depositor", not "does it belong to this exact deposit". Notes of one
 * denomination are interchangeable; the depositor is the thing an
 * investigation is actually after.
 */
export function normalise(scored, { expectedLinks = 1, cap = 0.99 } = {}) {
  const total = scored.reduce((sum, item) => sum + item.result.weight, 0);
  if (total <= 0) return scored;

  const links = Math.max(1, Math.min(expectedLinks, scored.length));
  for (const item of scored) {
    const share = (item.result.weight / total) * links;
    item.result.score = item.result.decisive ? 1 : Math.min(share, cap);
  }
  return scored;
}

/** Kept as the old name so callers reading like prose still work. */
export const scoreCandidate = combine;

/**
 * Words for a score.
 *
 * Graded on lift over the prior rather than the raw number, because the raw
 * number means different things in different pools: 5% in a set of 900 is a
 * 45× lift and the best lead you will get that day, while 5% in a set of 12 is
 * below chance. Coverage gates the top tiers, since a confident number built on
 * two answerable signals is a coincidence waiting to happen.
 */
export function tierFor({ score, decisive, coverage, priorProbability }) {
  if (decisive) return "confirmed";
  const lift = priorProbability > 0 ? score / priorProbability : 0;
  if (lift >= 10 && coverage >= 0.45) return "strong";
  if (lift >= 4 && coverage >= 0.3) return "moderate";
  if (lift >= 1.5) return "weak";
  return "noise";
}

/** What the UI needs to offer a signal checklist, without importing the logic. */
export function signalCatalogue() {
  return SIGNALS.map((signal) => ({
    id: signal.id,
    label: signal.label,
    group: signal.group ?? "optional",
    lr: signal.lr,
    question: signal.question,
    /** Below 1 means the signal argues against a candidate. */
    negative: signal.lr < 1,
  }));
}

export const DEFAULT_SIGNALS = SIGNALS.map((signal) => signal.id);

export const TIER_LABELS = {
  confirmed: "Confirmed link",
  strong: "Strong lead",
  moderate: "Moderate lead",
  weak: "Weak lead",
  noise: "Noise",
};
