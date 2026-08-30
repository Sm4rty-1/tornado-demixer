/**
 * The analysis run.
 *
 * Given one deposit, produce a ranked list of withdrawals that could have been
 * funded by it, each with the evidence behind its position. Nothing here breaks
 * a proof: every candidate in the output is, cryptographically, exactly as
 * plausible as every other withdrawal of the same denomination. What the
 * ranking captures is behaviour around the proof.
 *
 * The run has two passes:
 *
 *   scan  — one log query per pool, plus the depositor's transaction list.
 *           Enough for every signal that a log carries: recipients, relayers,
 *           fees, timing, gas price, denomination profiles.
 *   deep  — per-candidate transaction, block and one-hop follow-on lookups for
 *           the top of the ranking only, because these cost a request each.
 *
 * Splitting them is what keeps a browser run to a few seconds: the expensive
 * questions are only asked about candidates that survived the cheap ones.
 */

import {
  POOLS,
  PROTOCOL_ADDRESSES,
  ROUTER,
  SECONDS_PER_BLOCK,
  SELECTOR_DEPOSIT_POOL,
  SELECTOR_DEPOSIT_ROUTER,
  TOPIC_WITHDRAWAL,
  poolByAddress,
  poolById,
  poolByValue,
} from "./constants.js";
import { decodeWithdrawal, isTxHash, sameAddress, word, wordToAddress } from "./hex.js";
import {
  SIGNALS,
  combine,
  compareDenominations,
  formatWindow,
  isSelfRelayed,
  normalise,
  tierFor,
} from "./heuristics.js";

export const DEFAULTS = {
  /** How far past the deposit to look for the withdrawal. */
  windowDays: 30,
  /** Deposits this close together are treated as one session — one sitting. */
  sessionGapHours: 24,
  /** How many candidates the deep pass is allowed to spend requests on. */
  deepCandidates: 12,
  /** Pull the depositor's history; needed for counterparty and profile signals. */
  useHistory: true,
  /** Run the deep pass at all. */
  deep: true,
  /**
   * How far either side of the mixer to look for the same asset going out and
   * coming back. Long enough to cover a deliberate pause, short enough that
   * ordinary trading does not fill the window with coincidences.
   */
  roundTripDays: 14,
  /** Signal ids to score with. null means every signal. */
  signals: null,
  /**
   * Drop candidates holding notes the depositor never deposited. Off by
   * default: when the depositor's history is truncated, an address can look
   * "excess" only because we could not read far enough back. The soft version
   * of this is the denomination-excess signal, which always applies.
   */
  exactDenominationsOnly: false,
};

class Progress {
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.phase = "";
  }

  set(phase, message, extra = {}) {
    this.phase = phase;
    this.onProgress?.({ phase, message, ...extra });
  }
}

/**
 * Work out which pool a transaction deposited into.
 *
 * Three shapes to handle: a direct pool call, a router call carrying the pool
 * in word 0, and — for ETH — a value that matches exactly one denomination.
 */
export function resolveDepositPool(tx) {
  const selector = (tx.input ?? "0x").slice(0, 10);

  if (selector === SELECTOR_DEPOSIT_ROUTER) {
    const pool = poolByAddress(wordToAddress(word(tx.input, 1)));
    if (pool) return pool;
  }

  if (selector === SELECTOR_DEPOSIT_POOL) {
    const pool = poolByAddress(tx.to);
    if (pool) return pool;
  }

  const direct = poolByAddress(tx.to);
  if (direct) return direct;

  // Router call we could not decode, but ETH value pins the denomination.
  if (sameAddress(tx.to, ROUTER) && tx.value > 0n) return poolByValue(tx.value);

  return null;
}

/**
 * Is this a person paying a person, rather than a wallet poking a contract?
 *
 * It matters more than it sounds. Counterparty and downstream-convergence both
 * ask "do these two addresses know each other", and if contract calls count,
 * the answer is yes for everyone: the first version of this signal happily
 * reported that a candidate had "moved funds on to an address the depositor
 * also uses" when the address in question was the USDT contract. Half of
 * Ethereum shares that counterparty.
 *
 * A bare value transfer has no calldata, so this costs nothing to check and
 * throws away exactly the relationships that were never relationships. Sending
 * an ERC-20 between two of your own addresses lands on the token contract in a
 * transaction list, not the recipient, so nothing real is lost either.
 */
function isPlainTransfer(tx) {
  const input = tx.input ?? "0x";
  return tx.value > 0n && (input === "0x" || input === "0x0" || input === "");
}

/**
 * Tokens an address moved in one direction inside a time window.
 *
 * "Sent before depositing" and "received after withdrawing" are the two halves
 * of a round trip: sell the position, wash the proceeds, buy it back. Only the
 * token identity is kept — amounts are useless here, since the whole point of
 * the exercise is that the amount changed.
 */
function tokensMoved(transfers, address, { direction, from, to }) {
  const moved = new Map();
  if (!transfers) return null;

  for (const transfer of transfers) {
    if (transfer.timestamp == null || transfer.timestamp < from || transfer.timestamp > to) continue;
    const isOut = sameAddress(transfer.from, address);
    const isIn = sameAddress(transfer.to, address);
    if (direction === "out" ? !isOut : !isIn) continue;
    if (!transfer.token?.address) continue;
    moved.set(transfer.token.address, transfer.token);
  }
  return moved;
}

/** Contracts an address called — anything with calldata, minus the protocol itself. */
function contractsCalled(transactions, address) {
  const contracts = new Set();
  if (!transactions) return null;

  for (const tx of transactions) {
    if (tx.failed || !tx.to) continue;
    if (!sameAddress(tx.from, address)) continue;
    const input = tx.input ?? "0x";
    if (input === "0x" || input.length < 10) continue; // A plain transfer, not a call.
    if (PROTOCOL_ADDRESSES.has(tx.to)) continue;
    contracts.add(tx.to);
  }
  return contracts;
}

/** Every Tornado deposit in a transaction list, tagged with its pool. */
function depositsFromHistory(transactions) {
  const deposits = [];
  for (const tx of transactions) {
    if (tx.failed) continue;
    if (!tx.to || !PROTOCOL_ADDRESSES.has(tx.to)) continue;
    const pool = resolveDepositPool(tx);
    if (pool) deposits.push({ ...tx, pool });
  }
  return deposits.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Build what we know about the depositor: who they deal with, what they put in,
 * and whether this deposit was part of a burst.
 */
function buildDepositorProfile({ depositor, history, anchor, sessionGapHours }) {
  if (!history) {
    return { address: depositor, counterparties: null, deposits: [], denominationCounts: new Map(), session: null };
  }

  const counterparties = new Set();
  for (const tx of history) {
    if (tx.failed || !isPlainTransfer(tx)) continue;
    for (const address of [tx.to, tx.from]) {
      if (!address) continue;
      if (sameAddress(address, depositor)) continue;
      if (PROTOCOL_ADDRESSES.has(address)) continue;
      counterparties.add(address);
    }
  }

  const deposits = depositsFromHistory(history);

  // A session: deposits of the anchor's denomination clustered around it in
  // time. Users buying several notes at once do it in one sitting, and the
  // count they bought is the count they later have to withdraw.
  const gap = sessionGapHours * 3600;
  const sameDenomination = deposits.filter((d) => d.pool.id === anchor.pool.id);
  const sessionDeposits = [];
  for (const deposit of sameDenomination) {
    if (Math.abs(deposit.timestamp - anchor.timestamp) <= gap) sessionDeposits.push(deposit);
  }

  const denominationCounts = new Map();
  for (const deposit of deposits) {
    // Only count deposits inside the same sitting — a deposit from last year is
    // not part of this fingerprint.
    if (Math.abs(deposit.timestamp - anchor.timestamp) > gap) continue;
    denominationCounts.set(deposit.pool.id, (denominationCounts.get(deposit.pool.id) ?? 0) + 1);
  }
  if (denominationCounts.size === 0) denominationCounts.set(anchor.pool.id, 1);

  return {
    address: depositor,
    counterparties,
    deposits,
    denominationCounts,
    session: {
      deposits: Math.max(sessionDeposits.length, 1),
      poolId: anchor.pool.id,
      spanSeconds:
        sessionDeposits.length > 1
          ? sessionDeposits[sessionDeposits.length - 1].timestamp - sessionDeposits[0].timestamp
          : 0,
      transactions: sessionDeposits.map((d) => d.hash),
    },
  };
}

/** Withdrawal logs for one pool over the window, decoded into candidates. */
async function scanPool({ source, pool, fromBlock, toBlock, onProgress }) {
  const logs = await source.getLogs({
    address: pool.address,
    topic0: TOPIC_WITHDRAWAL,
    fromBlock,
    toBlock,
    onProgress,
  });

  const withdrawals = [];
  for (const log of logs) {
    const decoded = decodeWithdrawal(log);
    if (!decoded) continue;
    // A pool or the router as "recipient" is protocol plumbing, not a person.
    if (PROTOCOL_ADDRESSES.has(decoded.recipient)) continue;

    withdrawals.push({
      pool,
      recipient: decoded.recipient,
      relayer: decoded.relayer,
      fee: decoded.fee,
      nullifierHash: decoded.nullifierHash,
      txHash: log.txHash,
      blockNumber: log.blockNumber,
      timestamp: log.timestamp,
      gasPrice: log.gasPrice,
      tx: null,
      block: null,
    });
  }
  return withdrawals;
}

/**
 * Fill in the block timestamps a bare RPC source cannot supply inline. One
 * request per distinct block, which is why this is only ever run over a
 * candidate list rather than a whole scan.
 */
async function fillTimestamps(source, items) {
  const missing = items.filter((item) => item.timestamp == null);
  const blocks = [...new Set(missing.map((item) => item.blockNumber))];
  for (const blockNumber of blocks) {
    const timestamp = await source.blockTimestamp(blockNumber);
    for (const item of missing) {
      if (item.blockNumber === blockNumber) item.timestamp = timestamp;
    }
  }
}

export async function demix({
  source,
  target,
  options = {},
  onProgress,
} = {}) {
  const config = { ...DEFAULTS, ...options };
  const progress = new Progress(onProgress);
  const warnings = [];

  // --- 1. the anchor deposit ------------------------------------------------
  progress.set("deposit", "Reading the deposit transaction");

  let anchorTx = null;
  let depositor = null;
  let pool = null;

  if (target.txHash) {
    if (!isTxHash(target.txHash)) throw new Error("That is not a transaction hash.");
    anchorTx = await source.getTransaction(target.txHash);
    if (!anchorTx) throw new Error("Transaction not found.");
    if (anchorTx.failed) throw new Error("That transaction reverted — it never deposited anything.");

    pool = resolveDepositPool(anchorTx);
    if (!pool) {
      throw new Error(
        "That transaction is not a Tornado Cash deposit. Give me the hash of the deposit itself.",
      );
    }
    depositor = anchorTx.from;
  } else if (target.address) {
    depositor = target.address.toLowerCase();
    pool = poolById(target.poolId);
    if (!pool) throw new Error("Analysing an address needs a pool to anchor on.");
  } else {
    throw new Error("Give me a deposit transaction hash or an address and pool.");
  }

  if (anchorTx && anchorTx.timestamp == null) {
    anchorTx.timestamp = await source.blockTimestamp(anchorTx.blockNumber);
  }

  // --- 2. the depositor's history ------------------------------------------
  let history = null;
  // A full page back means there is probably more we did not see, and any
  // conclusion drawn from "the depositor never deposited that" has to be
  // softened accordingly.
  const HISTORY_LIMIT = 300;
  let historyComplete = true;
  if (config.useHistory) {
    progress.set("history", "Reading the depositor's transaction history");
    try {
      history = await source.getAddressTransactions(depositor, { limit: HISTORY_LIMIT });
      if (history && history.length >= HISTORY_LIMIT) {
        historyComplete = false;
        warnings.push(
          `The depositor has more than ${HISTORY_LIMIT} transactions, so their deposit history may be incomplete. Evidence that an address holds more notes than they deposited is discounted accordingly.`,
        );
      }
    } catch (error) {
      warnings.push(`Could not read the depositor's history: ${error.message}`);
    }
    if (history === null) {
      warnings.push(
        "This data source cannot list an address's transactions, so counterparty, deposit-count and profile signals are unavailable.",
      );
    }
  }

  // Anchoring on an address rather than a hash: use their first deposit into
  // the chosen pool as the anchor.
  if (!anchorTx) {
    const deposits = depositsFromHistory(history ?? []).filter((d) => d.pool.id === pool.id);
    if (deposits.length === 0) {
      throw new Error(`No ${pool.denomination} ${pool.asset} deposits found for that address.`);
    }
    anchorTx = deposits[0];
  }

  const anchor = {
    txHash: anchorTx.hash,
    depositor,
    pool,
    blockNumber: anchorTx.blockNumber,
    timestamp: anchorTx.timestamp,
    tx: anchorTx,
    block: null,
  };

  const depositor_ = buildDepositorProfile({
    depositor,
    history,
    anchor,
    sessionGapHours: config.sessionGapHours,
  });
  depositor_.historyComplete = history ? historyComplete : null;
  depositor_.contractsUsed = contractsCalled(history, depositor);

  // --- 3. the search window -------------------------------------------------
  const windowBlocks = Math.round((config.windowDays * 86400) / SECONDS_PER_BLOCK);
  let latest = null;
  try {
    latest = await source.getBlockNumber();
  } catch {
    // Not fatal: without it the window just runs to its nominal end.
  }
  const fromBlock = anchor.blockNumber;
  const toBlock = Math.min(anchor.blockNumber + windowBlocks, latest ?? anchor.blockNumber + windowBlocks);

  // --- 4. scan ---------------------------------------------------------------
  // The anchor pool supplies the candidates. Any other pool the depositor used
  // in the same sitting is scanned too, but only to build denomination
  // profiles — a 1 ETH deposit can only have been withdrawn as 1 ETH.
  const profilePools = [...depositor_.denominationCounts.keys()]
    .map((id) => poolById(id))
    .filter((candidate) => candidate && candidate.id !== pool.id);

  progress.set("scan", `Scanning ${pool.denomination} ${pool.asset} withdrawals`, {
    pool: pool.id,
    fromBlock,
    toBlock,
  });

  const candidates = await scanPool({
    source,
    pool,
    fromBlock,
    toBlock,
    onProgress: (p) =>
      progress.set("scan", `Scanning ${pool.denomination} ${pool.asset} withdrawals`, { ...p, pool: pool.id }),
  });

  const recipientTotals = new Map();
  const countInto = (withdrawal) => {
    const totals = recipientTotals.get(withdrawal.recipient) ?? new Map();
    totals.set(withdrawal.pool.id, (totals.get(withdrawal.pool.id) ?? 0) + 1);
    recipientTotals.set(withdrawal.recipient, totals);
  };
  candidates.forEach(countInto);

  for (const other of profilePools) {
    progress.set("scan", `Scanning ${other.denomination} ${other.asset} withdrawals for profile matching`, {
      pool: other.id,
    });
    try {
      const extra = await scanPool({ source, pool: other, fromBlock, toBlock });
      extra.forEach(countInto);
    } catch (error) {
      warnings.push(`Could not scan the ${other.id} pool: ${error.message}`);
    }
  }

  await fillTimestamps(source, candidates);

  // A withdrawal before the deposit cannot be this deposit's.
  const viable = candidates.filter(
    (candidate) => candidate.timestamp != null && candidate.timestamp >= anchor.timestamp,
  );

  // --- 5. score (cheap pass) -------------------------------------------------
  progress.set("score", `Scoring ${viable.length} candidate withdrawals`, { total: viable.length });

  const ctx = {
    deposit: anchor,
    depositor: depositor_,
    recipientTotals,
    downstream: null,
  };

  // The strict view: an address holding notes the depositor never deposited is
  // not this depositor's exit at all. Off by default — see DEFAULTS.
  let filtered = viable;
  let excluded = 0;
  if (config.exactDenominationsOnly) {
    filtered = viable.filter((candidate) => {
      const got = recipientTotals.get(candidate.recipient);
      if (!got) return true;
      return compareDenominations(depositor_.denominationCounts, got).excess === 0;
    });
    excluded = viable.length - filtered.length;
    if (excluded > 0) {
      warnings.push(
        `${excluded} candidate${excluded === 1 ? "" : "s"} hidden: they hold withdrawals the depositor never deposited, and exact matching is on.`,
      );
    }
  }

  // The depositor bought `session.deposits` notes of this denomination, so that
  // is how many of these withdrawals should turn out to be theirs.
  const enabled = config.signals ? new Set(config.signals) : null;
  const scoring = { anonymitySet: viable.length, enabled };
  const expectedLinks = depositor_.session?.deposits ?? 1;
  const rank = (list) =>
    normalise(list, { expectedLinks }).sort((a, b) => b.result.score - a.result.score);

  let ranked = rank(filtered.map((candidate) => ({ candidate, result: combine(ctx, candidate, scoring) })));

  // --- 6. deep pass ----------------------------------------------------------
  if (config.deep && ranked.length > 0) {
    const top = ranked.slice(0, config.deepCandidates);
    progress.set("deep", `Fetching detail for the top ${top.length} candidates`, { total: top.length });

    // The deposit's own block, for the builder comparison.
    try {
      anchor.block = await source.getBlock?.(anchor.blockNumber);
    } catch {
      /* builder signal stays unavailable */
    }

    // What the depositor moved out of in the run-up to the deposit. Fetched
    // once, compared against every candidate.
    const roundTripSeconds = config.roundTripDays * 86400;
    try {
      const depositorTokens = await source.getTokenTransfers?.(depositor, { limit: 200 });
      depositor_.tokensSentBefore = tokensMoved(depositorTokens, depositor, {
        direction: "out",
        from: anchor.timestamp - roundTripSeconds,
        to: anchor.timestamp,
      });
    } catch (error) {
      warnings.push(`Could not read the depositor's token history: ${error.message}`);
    }

    const downstream = new Map();
    let done = 0;
    for (const { candidate } of top) {
      try {
        candidate.tx = await source.getTransaction(candidate.txHash);
        if (anchor.block) candidate.block = await source.getBlock?.(candidate.blockNumber);

        // What did this address buy after being paid? The other half of a
        // round trip, and only worth asking if we saw the first half.
        if (depositor_.tokensSentBefore?.size) {
          const theirTokens = await source.getTokenTransfers?.(candidate.recipient, { limit: 100 });
          candidate.tokensReceivedAfter = tokensMoved(theirTokens, candidate.recipient, {
            direction: "in",
            from: candidate.timestamp,
            to: candidate.timestamp + config.roundTripDays * 86400,
          });
        }

        // One hop out: where did this address send funds next?
        if (depositor_.counterparties) {
          const onward = await source.getAddressTransactions(candidate.recipient, { limit: 50 });
          if (onward) {
            // The same response also says which contracts they use.
            candidate.contractsUsed = contractsCalled(onward, candidate.recipient);
            const destinations = new Set();
            for (const tx of onward) {
              if (!tx.to || tx.failed || !isPlainTransfer(tx)) continue;
              if (sameAddress(tx.from, candidate.recipient) && !PROTOCOL_ADDRESSES.has(tx.to)) {
                destinations.add(tx.to);
              }
            }
            downstream.set(candidate.recipient, destinations);
          }
        }
      } catch (error) {
        warnings.push(`Detail lookup failed for ${candidate.txHash.slice(0, 12)}…: ${error.message}`);
      }
      done += 1;
      progress.set("deep", `Fetching detail for the top ${top.length} candidates`, {
        done,
        total: top.length,
      });
    }

    ctx.downstream = downstream;
    ranked = rank(ranked.map(({ candidate }) => ({ candidate, result: combine(ctx, candidate, scoring) })));
  }

  // --- 7. report -------------------------------------------------------------
  const results = ranked.map(({ candidate, result }, index) => ({
    rank: index + 1,
    recipient: candidate.recipient,
    txHash: candidate.txHash,
    blockNumber: candidate.blockNumber,
    timestamp: candidate.timestamp,
    delaySeconds: candidate.timestamp - anchor.timestamp,
    relayer: candidate.relayer,
    fee: candidate.fee,
    score: result.score,
    priorProbability: result.priorProbability,
    coverage: result.coverage,
    decisive: result.decisive,
    tier: tierFor(result),
    evidence: result.evidence,
  }));

  // One address can take several withdrawals, and when it does that is the
  // finding — four rows for one recipient reads as four leads unless they are
  // folded together. Investigations are run against addresses, so this is the
  // view the CLI and the web UI both lead with.
  const candidateByHash = new Map(viable.map((candidate) => [candidate.txHash, candidate]));

  const byRecipient = [...groupBy(results, (result) => result.recipient)]
    .map(([recipient, taken]) => ({
      recipient,
      withdrawals: taken.length,
      total: `${Number(anchor.pool.denomination) * taken.length} ${anchor.pool.asset}`,
      bestScore: Math.max(...taken.map((result) => result.score)),
      tier: taken.reduce((best, result) => rankTier(result.tier) > rankTier(best) ? result.tier : best, "noise"),
      firstSeen: Math.min(...taken.map((result) => result.timestamp)),
      transactions: taken.map((result) => result.txHash),
      evidence: taken[0].evidence,
      dossier: buildDossier({
        recipient,
        taken,
        candidates: taken.map((result) => candidateByHash.get(result.txHash)).filter(Boolean),
        recipientTotals,
        downstream: ctx.downstream,
        anchor,
      }),
    }))
    .sort((a, b) => b.bestScore - a.bestScore || b.withdrawals - a.withdrawals);

  return {
    deposit: {
      txHash: anchor.txHash,
      depositor,
      pool: anchor.pool,
      blockNumber: anchor.blockNumber,
      timestamp: anchor.timestamp,
      selfRelayedGasPrice: anchor.tx?.gasPrice ?? null,
    },
    depositor: {
      address: depositor,
      knownCounterparties: depositor_.counterparties?.size ?? null,
      session: depositor_.session,
      denominationCounts: Object.fromEntries(depositor_.denominationCounts),
    },
    window: {
      fromBlock,
      toBlock,
      days: config.windowDays,
      // Held as a float so sub-day scans work; carried as words so every
      // consumer says "6 hours" rather than "0.25 days".
      label: formatWindow(config.windowDays),
      latestBlock: latest,
    },
    stats: {
      // Reported rather than silently applied: a filtered list that does not say
      // what it removed reads as "there was nothing else there".
      excludedByFilters: excluded,
      historyComplete: depositor_.historyComplete,
      signalsUsed: config.signals ?? SIGNALS.map((signal) => signal.id),
      // The honest denominator: how many withdrawals this deposit is hiding
      // among. A top-ranked candidate out of 4 means something; out of 900 it
      // is a starting point and nothing more.
      anonymitySet: viable.length,
      scanned: candidates.length,
      requests: source.requestCount,
      signals: SIGNALS.map((signal) => ({ id: signal.id, label: signal.label, weight: signal.weight })),
    },
    warnings,
    results,
    byRecipient,
    // Kept on the report so split-exit clustering can run without a second
    // pass over the chain.
    downstream: ctx.downstream
      ? Object.fromEntries([...ctx.downstream].map(([address, set]) => [address, [...set]]))
      : null,
  };
}

/**
 * Everything the run learned about one address, as facts rather than scores.
 *
 * The ranking says where to look; this says what to look at. Nothing here is
 * inferred — every field is something observed on chain during the run, which
 * is what makes it checkable by hand. Where the tool could not see something it
 * says so, rather than leaving a blank that reads as a zero.
 */
function buildDossier({ recipient, taken, candidates, recipientTotals, downstream, anchor }) {
  const relayers = new Set();
  const gasPrices = [];
  let selfRelayed = 0;
  let feesPaid = 0n;
  let tokensAfter = null;
  let contracts = null;

  for (const candidate of candidates) {
    if (candidate.relayer) relayers.add(candidate.relayer);
    if (candidate.gasPrice) gasPrices.push(candidate.gasPrice);
    if (isSelfRelayed(candidate)) selfRelayed += 1;
    feesPaid += candidate.fee ?? 0n;
    if (candidate.tokensReceivedAfter) {
      tokensAfter = tokensAfter ?? new Map();
      for (const [address, token] of candidate.tokensReceivedAfter) tokensAfter.set(address, token);
    }
    if (candidate.contractsUsed) {
      contracts = contracts ?? new Set();
      for (const address of candidate.contractsUsed) contracts.add(address);
    }
  }

  const delays = taken.map((result) => result.delaySeconds);
  const received = recipientTotals.get(recipient);
  const onward = downstream?.get(recipient) ?? null;

  return {
    // What arrived, across every pool the run scanned.
    receivedByPool: received ? Object.fromEntries(received) : {},
    withdrawals: taken.map((result) => ({
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      timestamp: result.timestamp,
      delaySeconds: result.delaySeconds,
      relayer: result.relayer,
      fee: result.fee,
    })),
    firstDelaySeconds: Math.min(...delays),
    lastDelaySeconds: Math.max(...delays),
    // Who paid the gas. Self-relayed withdrawals carry the user's own wallet
    // fingerprint; relayed ones carry the relayer's, and that distinction
    // decides which of the gas questions can be asked at all.
    selfRelayed,
    relayers: [...relayers],
    feesPaid,
    gasPrices,
    /** null means the deep pass did not run or the source could not answer. */
    tokensAfter: tokensAfter ? [...tokensAfter.values()].map((token) => token.symbol) : null,
    contractsUsed: contracts ? [...contracts] : null,
    onwardTo: onward ? [...onward] : null,
    /** Same block as the deposit is worth an eyebrow; the run records it either way. */
    sameBlockAsDeposit: candidates.some((candidate) => candidate.blockNumber === anchor.blockNumber),
  };
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const TIER_ORDER = ["noise", "weak", "moderate", "strong", "confirmed"];
function rankTier(tier) {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Group a finished run's candidates by where their funds went next, which is
 * how split exits give themselves away: five withdrawals to five fresh
 * addresses that all forward to one place were one user.
 */
export function clusterByDownstream(report) {
  if (!report.downstream) return [];
  const clusters = new Map();
  const seen = new Set();
  for (const result of report.results) {
    if (seen.has(result.recipient)) continue;
    seen.add(result.recipient);
    const destinations = report.downstream[result.recipient];
    if (!destinations) continue;
    for (const destination of destinations) {
      const bucket = clusters.get(destination) ?? [];
      bucket.push(result.recipient);
      clusters.set(destination, bucket);
    }
  }
  return [...clusters.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([destination, members]) => ({ destination, members }))
    .sort((a, b) => b.members.length - a.members.length);
}

export { POOLS };
