#!/usr/bin/env node
/**
 * The command line front end.
 *
 * All of the analysis lives in core/ — this file only parses arguments, prints
 * things and writes files. Keeping the split strict is what lets the same
 * engine run in a browser on sm4rty.xyz without a build step.
 */

import { writeFile } from "node:fs/promises";
import { argv, env, exit, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  DEFAULTS,
  POOLS,
  TIER_LABELS,
  clusterByDownstream,
  createSource,
  demix,
  formatDelay,
  isTxHash,
  toCsv,
  toJson,
  toSummary,
} from "./core/index.js";

// --- colour ----------------------------------------------------------------
// Six escape codes, rather than a dependency that has to be kept current.
const useColour = stdout.isTTY && env.NO_COLOR === undefined;
const paint = (code) => (text) => (useColour ? `\u001b[${code}m${text}\u001b[0m` : String(text));
const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("34");
const cyan = paint("36");

const TIER_COLOUR = {
  confirmed: red,
  strong: yellow,
  moderate: cyan,
  weak: blue,
  noise: dim,
};

const USAGE = `
${bold("tornado-demixer")} — rank the withdrawals a Tornado Cash deposit could have become.

${bold("Usage")}
  tornado-demixer <deposit-tx-hash> [options]
  tornado-demixer --address <0x…> --pool <pool-id> [options]
  tornado-demixer pools

${bold("Options")}
  --window <n>[h|d]    How far past the deposit to search        (default ${DEFAULTS.windowDays}d)
                       Measured from the deposit block: 6h, 3d, 30d
  --top <n>            How many candidates to print              (default 10)
  --no-deep            Skip per-candidate lookups; scan only
  --deep-candidates <n> How many candidates the deep pass covers (default ${DEFAULTS.deepCandidates})
  --source <name>      blockscout | etherscan | rpc              (default blockscout)
  --rpc-url <url>      For --source rpc; needs an archive node
  --api-key <key>      For --source etherscan
  --csv <path>         Write the full ranking as CSV
  --json <path>        Write the whole run, evidence included
  --quiet              Only print the ranking
  --check              Test the data source and exit

${bold("Environment")}
  TORNADO_RPC_URL      Used when --source rpc is given without --rpc-url
  ETHERSCAN_API_KEY    Used when --source etherscan is given without --api-key

${dim("Every result is a probabilistic lead, not proof. Read the evidence column.")}
`;

function parseArgs(args) {
  const options = { top: 10, deep: true };
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => args[(i += 1)];

    switch (arg) {
      case "-h":
      case "--help": options.help = true; break;
      case "--window": options.windowDays = parseWindow(next()); break;
      // Kept so older invocations and scripts do not break.
      case "--window-days": options.windowDays = Number(next()); break;
      case "--check": options.check = true; break;
      case "--top": options.top = Number(next()); break;
      case "--deep-candidates": options.deepCandidates = Number(next()); break;
      case "--no-deep": options.deep = false; break;
      case "--source": options.source = next(); break;
      case "--rpc-url": options.rpcUrl = next(); break;
      case "--api-key": options.apiKey = next(); break;
      case "--address": options.address = next(); break;
      case "--pool": options.poolId = next(); break;
      case "--csv": options.csv = next(); break;
      case "--json": options.json = next(); break;
      case "--quiet": options.quiet = true; break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  return { options, positional };
}

/** "6h" / "3d" / "12" -> days as a float, since windows can be sub-day. */
function parseWindow(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([hd]?)$/i.exec(String(value).trim());
  if (!match) throw new Error(`Cannot read "${value}" as a window. Use 6h or 3d.`);
  const amount = Number(match[1]);
  return match[2].toLowerCase() === "h" ? amount / 24 : amount;
}

function printPools() {
  console.log(bold("\n  Pool             Asset   Denomination   Address\n"));
  for (const pool of POOLS) {
    console.log(
      `  ${pool.id.padEnd(16)} ${pool.asset.padEnd(7)} ${pool.denomination.padEnd(14)} ${dim(pool.address)}`,
    );
  }
  console.log();
}

/** A progress line that rewrites itself rather than scrolling. */
function progressReporter(quiet) {
  if (quiet || !stdout.isTTY) return () => {};
  let last = "";
  return ({ phase, message, done, total, found }) => {
    const counter =
      done != null && total ? ` ${Math.min(100, Math.round((done / total) * 100))}%` : "";
    const hits = found != null ? dim(` ${found} found`) : "";
    const line = `  ${cyan(phase.padEnd(8))} ${message}${counter}${hits}`;
    if (line === last) return;
    last = line;
    stdout.write(`\r\u001b[K${line}`);
  };
}

function printReport(report, { top }) {
  const { deposit, depositor, stats, window } = report;
  const denomination = `${deposit.pool.denomination} ${deposit.pool.asset}`;

  console.log(`\n${bold("Deposit")}`);
  console.log(`  ${denomination} from ${bold(deposit.depositor)}`);
  console.log(`  ${dim(deposit.txHash)}`);
  console.log(`  block ${deposit.blockNumber}, ${new Date(deposit.timestamp * 1000).toISOString()}`);

  if (depositor.session?.deposits > 1) {
    console.log(
      `  ${yellow("session")}: ${depositor.session.deposits} × ${denomination} deposited within ${formatDelay(depositor.session.spanSeconds)}`,
    );
  }
  const profile = Object.entries(depositor.denominationCounts)
    .map(([id, count]) => `${count}× ${id}`)
    .join(", ");
  if (profile) console.log(`  ${dim(`denomination profile: ${profile}`)}`);

  console.log(`\n${bold("Search")}`);
  console.log(`  blocks ${window.fromBlock}–${window.toBlock} (${window.label})`);
  console.log(
    `  ${bold(stats.anonymitySet)} withdrawals of ${denomination} left the pool in that window — the anonymity set`,
  );
  console.log(dim(`  ${stats.requests} requests to the data source`));

  for (const warning of report.warnings) console.log(`  ${yellow("!")} ${warning}`);

  console.log(`\n${bold("Ranked recipients")}   ${dim("(share of the depositor's notes, prior = " + (100 / Math.max(1, stats.anonymitySet)).toFixed(1) + "%)")}\n`);

  const rows = report.byRecipient.slice(0, top);
  if (rows.length === 0) {
    console.log(dim("  No withdrawals in the window.\n"));
    return;
  }

  for (const [index, row] of rows.entries()) {
    const colour = TIER_COLOUR[row.tier] ?? dim;
    const score = `${(row.bestScore * 100).toFixed(1)}%`.padStart(6);
    console.log(
      `  ${String(index + 1).padStart(2)}. ${colour(score)}  ${colour(TIER_LABELS[row.tier].padEnd(14))} ${row.recipient}  ${dim(`${row.withdrawals}× ${deposit.pool.denomination} ${deposit.pool.asset}`)}`,
    );
  }

  // The evidence behind the top answer, which is the part worth reading.
  const best = report.results[0];
  if (best) {
    console.log(`\n${bold("Why " + best.recipient + " is first")}`);
    for (const item of best.evidence) {
      if (item.score == null) {
        console.log(`  ${dim("—".padEnd(7))} ${dim(item.label.padEnd(24))} ${dim(item.detail)}`);
        continue;
      }
      const lift = `×${item.multiplier.toFixed(1)}`;
      const marker = item.multiplier > 1.5 ? green(lift.padEnd(7)) : dim(lift.padEnd(7));
      console.log(`  ${marker} ${item.label.padEnd(24)} ${item.detail}`);
    }
  }

  // Split exits: several fresh recipients forwarding to one place is one user
  // pretending to be several.
  const clusters = clusterByDownstream(report);
  if (clusters.length > 0) {
    console.log(`\n${bold("Split-exit clusters")}`);
    for (const cluster of clusters.slice(0, 5)) {
      console.log(`  ${cluster.members.length} candidates forwarded to ${yellow(cluster.destination)}`);
      for (const member of cluster.members) console.log(`    ${dim(member)}`);
    }
  }

  console.log(`\n${dim(toSummary(report))}\n`);
}

async function promptForHash() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(green("Deposit transaction hash: "));
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const { options, positional } = parseArgs(argv.slice(2));

  if (options.help) return console.log(USAGE);
  if (positional[0] === "pools") return printPools();

  const source = createSource({
    kind: options.source ?? "blockscout",
    rpcUrl: options.rpcUrl ?? env.TORNADO_RPC_URL,
    apiKey: options.apiKey ?? env.ETHERSCAN_API_KEY,
  });

  // Checking the source is about the source, so it must not need a target.
  if (options.check) {
    console.log(dim(`\n  source: ${source.label}`));
    const probe = await source.probe();
    console.log(`  ${probe.ok ? green("ok") : red("failed")}  ${probe.message}`);
    if (probe.ok && probe.archive === false) {
      console.log(yellow("  This source cannot run a scan. Point --rpc-url at an archive node.\n"));
    } else {
      console.log();
    }
    return;
  }

  let hash = positional[0];
  if (!hash && !options.address) {
    if (!process.stdin.isTTY) return console.log(USAGE);
    hash = await promptForHash();
  }
  if (hash && !isTxHash(hash)) throw new Error(`"${hash}" is not a transaction hash.`);

  if (!options.quiet) console.log(dim(`\n  source: ${source.label}`));

  const report = await demix({
    source,
    target: hash ? { txHash: hash } : { address: options.address, poolId: options.poolId },
    options: {
      windowDays: options.windowDays ?? DEFAULTS.windowDays,
      deep: options.deep,
      deepCandidates: options.deepCandidates ?? DEFAULTS.deepCandidates,
    },
    onProgress: progressReporter(options.quiet),
  });

  if (stdout.isTTY && !options.quiet) stdout.write("\r\u001b[K");
  printReport(report, { top: options.top });

  if (options.csv) {
    await writeFile(options.csv, toCsv(report), "utf8");
    console.log(dim(`  wrote ${options.csv}`));
  }
  if (options.json) {
    await writeFile(options.json, toJson(report), "utf8");
    console.log(dim(`  wrote ${options.json}`));
  }
}

main().catch((error) => {
  console.error(`\n${red("error")} ${error.message}\n`);
  exit(1);
});
