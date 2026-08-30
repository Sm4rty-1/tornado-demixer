/**
 * Turning a run into something you can hand to someone else.
 *
 * Both formats keep the per-signal breakdown. A candidate list without its
 * evidence is just an accusation, and the whole point of the scoring is that a
 * reader can disagree with it line by line.
 */

import { TIER_LABELS, formatDelay } from "./heuristics.js";
import { formatUnits } from "./hex.js";

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per candidate, one column per signal. */
export function toCsv(report) {
  const signalIds = report.stats.signals.map((signal) => signal.id);
  const header = [
    "rank",
    "tier",
    "score",
    "coverage",
    "recipient",
    "withdrawal_tx",
    "block",
    "timestamp_utc",
    "delay",
    "relayer",
    "relayer_fee",
    ...signalIds,
  ];

  const rows = report.results.map((result) => {
    const byId = new Map(result.evidence.map((item) => [item.id, item]));
    return [
      result.rank,
      TIER_LABELS[result.tier] ?? result.tier,
      result.score.toFixed(4),
      result.coverage.toFixed(2),
      result.recipient,
      result.txHash,
      result.blockNumber,
      new Date(result.timestamp * 1000).toISOString(),
      formatDelay(result.delaySeconds),
      result.relayer ?? "",
      formatUnits(result.fee, report.deposit.pool.decimals),
      ...signalIds.map((id) => {
        const evidence = byId.get(id);
        return evidence?.score == null ? "n/a" : evidence.score.toFixed(3);
      }),
    ].map(csvCell).join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

/** The full run, with BigInts flattened to strings so it survives a round trip. */
export function toJson(report, { indent = 2 } = {}) {
  return JSON.stringify(
    report,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    indent,
  );
}

/** A one-paragraph summary — the thing worth pasting into a report. */
export function toSummary(report) {
  const { deposit, stats, results } = report;
  const top = results[0];
  const denomination = `${deposit.pool.denomination} ${deposit.pool.asset}`;

  if (!top) {
    return `No withdrawals of ${denomination} were found in the ${report.window.label} after this deposit.`;
  }

  // Count addresses, not withdrawal rows — one recipient taking four notes is
  // one lead, and saying "four strong leads" would overstate the finding.
  const recipients = report.byRecipient ?? [];
  const confirmed = recipients.filter((entry) => entry.tier === "confirmed").length;
  const strong = recipients.filter((entry) => entry.tier === "strong").length;
  const prior = top.priorProbability ?? 1 / Math.max(1, stats.anonymitySet);

  const lines = [
    `Deposit ${deposit.txHash} put ${denomination} into Tornado Cash from ${deposit.depositor}.`,
    `In the ${report.window.label} that followed, ${stats.anonymitySet} withdrawals of that denomination left the pool — that is the anonymity set this deposit is hiding in.`,
  ];

  if (confirmed > 0) {
    lines.push(`${confirmed} went back to the depositor's own address, which is not a lead but a link.`);
  }
  if (strong > 0) {
    lines.push(
      `${strong} ${strong === 1 ? "address ranks" : "addresses rank"} as a strong lead on behavioural evidence alone.`,
    );
  }
  lines.push(
    `The top-ranked recipient is ${top.recipient} at ${(top.score * 100).toFixed(0)}%, against a ${(prior * 100).toFixed(1)}% prior — ${(top.score / prior).toFixed(0)}× what chance alone would give it — ${formatDelay(top.delaySeconds)} after the deposit.`,
  );

  return lines.join(" ");
}
