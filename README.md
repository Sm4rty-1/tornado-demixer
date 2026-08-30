# tornado-demixer

Rank the withdrawals a Tornado Cash deposit could have become, and show the evidence behind every position.

It does not break zero-knowledge proofs. Nothing here touches the cryptography, which works exactly as advertised: given a withdrawal, every deposit of the same denomination is an equally valid explanation. What this tool reads is everything the user did *around* the proof — when they deposited, how many notes they bought, what they paid for gas, who they had dealt with before, where the money went next. That behaviour is public, and it leaks.

```
Ranked recipients   (share of the depositor's notes, prior = 2.4%)

   1.  47.5%  Strong lead    0x8b03f94cde7f40815ad8c5d34135aa01ef58b84c  4× 1 ETH
   2.  17.1%  Moderate lead  0xbde4971debabf1846170c32840e89a620020577d  2× 1 ETH
   3.   6.1%  Weak lead      0x204f75f7232e1bca54b264c822dc567e869cab3d  1× 1 ETH

Why 0x8b03f94cde7f40815ad8c5d34135aa01ef58b84c is first
  ×80.0   Denomination profile     Recipient received the depositor's full denomination
                                   fingerprint (eth-10: wanted 1, saw 3; eth-1: wanted 3, saw 4).
  ×8.5    Deposit count match      Depositor made 3 deposits of 1 ETH; this address received 4.
  ×2.8    Timing proximity         Withdrawn 1.3 days after the deposit.
  —       Gas price fingerprint    Not applicable.
```

There is a browser version at **[sm4rty.xyz/tools/tornado-demixer](https://sm4rty.xyz/tools/tornado-demixer)** running the same engine, with no install and no API key.

## Install

Node 20.9 or newer. There are no dependencies to install — not a convenience, a design constraint: `src/core/` has to run unchanged in a browser.

```bash
git clone https://github.com/Sm4rty-1/tornado-demixer
cd tornado-demixer
node src/cli.js --help
```

## Usage

```bash
# The common case: one deposit, the default 30-day window.
node src/cli.js 0xa62f69b29b866307afd4ea5b930df39c44009c842c4b61da0e80bbb7e33fa105

# Narrow the window, print more of the ranking, save the evidence.
node src/cli.js 0xa62f…a105 --window 6h --top 25 --csv candidates.csv --json run.json

# Check a data source before relying on it (catches bad keys and non-archive RPCs).
node src/cli.js --check --source rpc --rpc-url https://…

# Start from an address instead of a transaction.
node src/cli.js --address 0x43e0…a596 --pool eth-1

# List the pools it knows about.
node src/cli.js pools
```

### Options

| Flag | Meaning | Default |
| --- | --- | --- |
| `--window <n>[h\|d]` | How far past the deposit to search, from the deposit block: `6h`, `3d` | `30d` |
| `--top <n>` | How many recipients to print | `10` |
| `--no-deep` | Scan only; skip per-candidate lookups | deep on |
| `--deep-candidates <n>` | How many candidates the deep pass covers | `12` |
| `--source <name>` | `blockscout`, `etherscan` or `rpc` | `blockscout` |
| `--rpc-url <url>` | Archive RPC, for `--source rpc` | `$TORNADO_RPC_URL` |
| `--api-key <key>` | For `--source etherscan` | `$ETHERSCAN_API_KEY` |
| `--csv <path>` / `--json <path>` | Write the ranking / the whole run | — |
| `--check` | Test the data source and exit | — |

### Data sources

The default is Blockscout's public API: no key, no signup, and it returns each log with its timestamp and gas price already attached, so a scan of a thousand withdrawals costs a handful of requests instead of a thousand.

`--check` probes a source before you depend on it: it reports a rejected API key
immediately, and it detects an endpoint that connects but will not serve wide
historical log queries, which is the failure mode people actually hit.

`--source rpc` accepts any JSON-RPC URL but needs an **archive** node. Public endpoints cap `eth_getLogs` at 10–50 blocks, which makes a real scan impractical; the tool splits ranges to cope, but a 30-day window against a public RPC will take a very long time. Point it at Alchemy, Infura or your own node.

Nothing in this repository contains an API key, and the tool works without one.

## The heuristics

Each signal answers one question and returns a strength in [0, 1] — or declines to answer. Declining matters as much as answering: a relayed withdrawal's gas was paid by the relayer, so any gas-shaped question about it is *unanswerable*, not answered "no".

| Signal | Question | LR |
| --- | --- | --- |
| Address reuse | Did the money go back to the address that sent it in? | decisive |
| Known counterparty | Has the depositor ever transacted with this recipient? | ×150 |
| Denomination profile | Did one address receive the same *mix* of pool sizes the depositor used? | ×80 |
| Downstream convergence | Do the withdrawn funds move on somewhere the depositor already uses? | ×60 |
| Asset round trip | Did the depositor sell a token before depositing and this address buy it back after withdrawing? | ×30 |
| Unaccounted withdrawals | Does this address hold more notes than the depositor deposited? | **×0.12** (against) |
| Protocol overlap | Do both addresses use the same uncommon contracts? | ×7 |
| Deposit count | The depositor made N deposits of one size — did one address collect N? | ×25 |
| Gas price fingerprint | Identical, unusual gas price on both sides? *(self-relayed only)* | ×120 |
| Priority fee fingerprint | Same `maxPriorityFeePerGas` wallet setting? *(self-relayed only)* | ×20 |
| Relayer overlap | Has the depositor dealt with this relayer before? | ×6 |
| Timing proximity | How long did the money sit in the pool? (3-day half-life) | ×4 |
| Time-of-day match | Do both transactions fall in the same part of the depositor's day? | ×2.5 |
| Same block builder | Same builder, within a day? | ×1.4 |
| Transaction type | Same EIP-2718 type? *(self-relayed only)* | ×1.3 |

One of these points the other way. Every other signal can only push a candidate
up; **unaccounted withdrawals** has a ratio below 1, because an address holding
more notes than the depositor put in is shared — a consolidation point or an
exchange deposit address — and a shared sink is a worse answer to "where did
this depositor's money go", not a better one. The penalty is halved when the
depositor's history is too long to read in full, since the extra notes may be
theirs and simply invisible.

The likelihood ratios are judgement calls informed by the published work below, not measurements taken here. They live as constants in [`src/core/heuristics.js`](src/core/heuristics.js) precisely so you can disagree with one and re-run.

## How the score is built

Averaging the signals is the obvious approach and it is wrong. Most people do not withdraw to the address they deposited from, so the strongest signal scores zero for nearly every genuine candidate, and the average drags every honest lead toward nothing. **Absence of the strongest evidence is the normal case, not evidence of absence.**

So instead:

1. **Start from the prior.** If N withdrawals of that denomination left the pool in the window, any one of them is the deposit with probability 1/N. That N is the anonymity set, and it is reported next to every result.
2. **Multiply by what the behaviour says.** Each signal that fires multiplies the odds by its likelihood ratio, raised to how strongly it fired. A signal that does not fire multiplies by one and changes nothing.
3. **Normalise across the candidate set.** Candidates are competing claims, not independent ones — only so many of these withdrawals can be this depositor's. Weights are scaled so they sum to the number of notes the depositor actually bought. Without this you get four addresses at 90%: four confident answers to a question with one.

The result answers *"does this withdrawal belong to the depositor"*, not *"does it belong to this exact deposit"* — notes of one denomination are interchangeable, and the depositor is what an investigation is after anyway.

Tiers are graded on **lift over the prior**, not the raw percentage, because 5% means opposite things in a pool of 12 and a pool of 900.

## What it will not tell you

- **These are leads.** A strong lead is a place to start looking, not a conclusion. Corroborate with something outside these heuristics before you put a name on an address.
- **Disciplined users disappear.** Long random delays, no address reuse, a relayer every time, one denomination, no consolidation — do all of that and the tool has nothing to work with, correctly.
- **Coincidence is real.** In a busy pool, some address will match your deposit count by chance. The `coverage` column reports how many signals could actually speak; a confident number resting on two of them deserves suspicion.
- **The window is a guess.** A withdrawal outside `--window-days` is invisible to the run, and widening the window enlarges the anonymity set, which lowers every score. That tension is the analysis.

## Ethics

Tornado Cash was sanctioned by OFAC in 2022, and those sanctions on the protocol were lifted in March 2025; the legal position around use and analysis has kept moving since. Privacy tooling has entirely legitimate users, and this tool cannot tell them apart from anyone else — it ranks addresses, it does not judge them.

Written for compliance work, incident response, stolen-fund tracing and research. If you are using it to build a case against a person, the burden of corroboration is yours.

## Prior work and reading

- [Tutela: An Open-Source Tool for Assessing User-Privacy on Ethereum and Tornado Cash](https://arxiv.org/pdf/2201.06811) — the paper behind the address-match and unique-gas-price heuristics.
- [pareto-xyz/tutela-app](https://github.com/pareto-xyz/tutela-app) — the reference implementation.
- [tav-r/tornado_cash_heuristics](https://github.com/tav-r/tornado_cash_heuristics), [lambdaclass/tornado_cash_anonymity_tool](https://github.com/lambdaclass/tornado_cash_anonymity_tool), [pcaversaccio/tornado-cash-ether-withdrawal-decipherer](https://github.com/pcaversaccio/tornado-cash-ether-withdrawal-decipherer).
- [Unmasking the Mixer](https://osintteam.blog/unmasking-the-mixer-how-on-chain-sleuths-demix-tornado-cash-transactions-96bdd9473fcc) by OfficerCia — a good survey of the wider tooling, and where the split-exit and voucher framing here started.

## Layout

```
src/
  cli.js            argument parsing, printing, file output — nothing else
  core/
    constants.js    pools and topics, each verified against mainnet
    hex.js          the ~40 lines of ABI decoding this actually needs
    sources.js      Blockscout / Etherscan / RPC behind one interface
    heuristics.js   the signals, their ratios, and how they combine
    engine.js       the run: resolve, profile, scan, score, deepen
    report.js       CSV, JSON, and a paragraph you can paste into a report
```

`src/core/` is vendored into [sm4rty.xyz](https://sm4rty.xyz) verbatim so the web version and the CLI cannot drift apart in their analysis. That is why it has no dependencies and no Node built-ins.

## Licence

MIT. Built by [Samrat Gupta (Sm4rty)](https://sm4rty.xyz).
