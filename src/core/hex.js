/**
 * Just enough ABI decoding to read Tornado's logs and calldata.
 *
 * The previous version of this tool pulled in ethers for this. Every value we
 * need sits at a fixed 32-byte offset, so a full ABI coder buys nothing and
 * costs ~300KB in the browser bundle.
 */

/** The i-th 32-byte word of a hex blob, without the 0x. */
export function word(data, i) {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  return body.slice(i * 64, (i + 1) * 64);
}

/** A 32-byte word holding a left-padded address -> lowercase 0x address. */
export function wordToAddress(w) {
  return `0x${w.slice(24)}`.toLowerCase();
}

export function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0n;
    return BigInt(trimmed.startsWith("0x") ? trimmed : trimmed);
  }
  return 0n;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const asString = String(value);
  return Number(asString.startsWith("0x") ? BigInt(asString) : asString);
}

export function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isTxHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();
}

/** Base units -> a decimal string, trimmed. Avoids floats for token amounts. */
export function formatUnits(value, decimals) {
  const amount = toBigInt(value);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Wei -> gwei with three decimals, the resolution gas fingerprints need. */
export function formatGwei(value) {
  const gwei = Number(toBigInt(value)) / 1e9;
  return Number.isFinite(gwei) ? gwei.toFixed(3).replace(/\.?0+$/, "") : "?";
}

/**
 * Decode a Withdrawal log.
 *
 *   event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)
 *
 * `to` and `fee` come out of the data blob, `relayer` out of topic 1 — which is
 * why a log scan alone is enough to score most heuristics. Fetching the
 * withdrawal transaction (as the old version did, once per log) is only needed
 * for the gas-level signals.
 */
export function decodeWithdrawal(log) {
  const data = log.data ?? "0x";
  if (data.length < 2 + 64 * 3) return null;

  const relayerTopic = log.topics?.[1];
  return {
    recipient: wordToAddress(word(data, 0)),
    nullifierHash: `0x${word(data, 1)}`,
    relayer: relayerTopic ? wordToAddress(relayerTopic.slice(2)) : null,
    fee: BigInt(`0x${word(data, 2)}`),
  };
}

/**
 * Decode a Deposit log.
 *
 *   event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)
 */
export function decodeDeposit(log) {
  const data = log.data ?? "0x";
  if (data.length < 2 + 64 * 2) return null;

  return {
    commitment: log.topics?.[0] ? log.topics[1] : null,
    leafIndex: Number(BigInt(`0x${word(data, 0)}`)),
    timestamp: Number(BigInt(`0x${word(data, 1)}`)),
  };
}
