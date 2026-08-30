/**
 * Where chain data comes from.
 *
 * Three back ends, one shape. The engine never learns which one it got, so the
 * CLI (usually pointed at an archive RPC) and the website (usually keyless)
 * run identical analysis code.
 *
 *   BlockscoutSource  keyless, CORS-friendly, wide log ranges. The default.
 *   EtherscanSource   needs a free key; higher rate limits.
 *   RpcSource         any JSON-RPC URL. Wide log ranges need an archive node —
 *                     public endpoints cap eth_getLogs at 10-50 blocks.
 *
 * Blockscout and Etherscan return gasPrice and timeStamp inline with each log,
 * which is why a scan of a thousand withdrawals costs a handful of requests
 * rather than a thousand.
 */

import { TOPIC_WITHDRAWAL, POOLS } from "./constants.js";
import { toBigInt, toNumber } from "./hex.js";

/** The 1 ETH pool and its Withdrawal topic, used only as a probe target. */
const PROBE_ADDRESS = POOLS.find((pool) => pool.id === "eth-1").address;
const PROBE_TOPIC = TOPIC_WITHDRAWAL;

/** Blockscout and Etherscan both truncate a log query at this many results. */
const PAGE_LIMIT = 1000;

class RateLimiter {
  constructor(minIntervalMs) {
    this.minInterval = minIntervalMs;
    this.tail = Promise.resolve();
    this.last = 0;
  }

  /** Serialises calls and keeps them at least `minInterval` apart. */
  run(fn) {
    const result = this.tail.then(async () => {
      const wait = this.last + this.minInterval - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return fn();
    });
    // Keep the chain alive even when a call rejects.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class SourceError extends Error {
  constructor(message, { cause, retryable = false, status = null } = {}) {
    super(message);
    this.name = "SourceError";
    this.cause = cause;
    this.retryable = retryable;
    /** HTTP status, when there was one — callers turn 404 into "not found". */
    this.status = status;
  }
}

class Source {
  constructor({ minIntervalMs = 220, retries = 3, fetchImpl, signal } = {}) {
    this.limiter = new RateLimiter(minIntervalMs);
    this.retries = retries;
    this.fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.signal = signal;
    if (!this.fetchImpl) {
      throw new SourceError("No fetch implementation available (Node 18+ or a browser is required)");
    }
    /** Block number -> unix seconds, so a scan never asks twice. */
    this.blockTimes = new Map();
    this.requestCount = 0;
    /** Surfaced by the UI to suggest a key before the run dies. */
    this.rateLimitHits = 0;
  }

  get label() {
    return this.constructor.name;
  }

  async json(url, init) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await this.limiter.run(async () => {
          this.requestCount += 1;
          const response = await this.fetchImpl(url, { ...init, signal: this.signal });
          if (response.status === 429) {
            this.rateLimitHits += 1;
            // Named, not numbered: whoever sees this needs to know the fix is an
            // API key, not a retry.
            throw new SourceError(
              `Rate limited by ${new URL(url).host}. Add your own API key, or try a smaller window.`,
              { retryable: true, status: 429 },
            );
          }
          if (response.status >= 500) {
            throw new SourceError(`HTTP ${response.status} from ${new URL(url).host}`, {
              retryable: true,
              status: response.status,
            });
          }
          if (!response.ok) {
            throw new SourceError(`HTTP ${response.status} from ${new URL(url).host}`, {
              status: response.status,
            });
          }
          return response.json();
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastError = error;
        if (!error?.retryable || attempt === this.retries) break;
        // Back off: 400ms, 800ms, 1600ms.
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  /**
   * Logs across a range, split until every chunk comes back under the page
   * limit. Splitting on the response rather than guessing a safe chunk size
   * keeps quiet ranges to a single request and only pays for busy ones.
   */
  async getLogs({ address, topic0, fromBlock, toBlock, onProgress }) {
    const out = [];
    const stack = [[fromBlock, toBlock]];
    const span = Math.max(1, toBlock - fromBlock);
    let covered = 0;

    while (stack.length > 0) {
      const [start, end] = stack.pop();
      const page = await this.fetchLogPage({ address, topic0, fromBlock: start, toBlock: end });

      if (page.length >= PAGE_LIMIT && end > start) {
        // Truncated: halve and retry both sides.
        const mid = Math.floor((start + end) / 2);
        stack.push([mid + 1, end], [start, mid]);
        continue;
      }

      out.push(...page);
      covered += end - start + 1;
      onProgress?.({ done: Math.min(covered, span), total: span, found: out.length });
    }

    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  /** Cached block timestamps, for sources whose logs don't carry them. */
  async blockTimestamp(blockNumber) {
    if (this.blockTimes.has(blockNumber)) return this.blockTimes.get(blockNumber);
    const timestamp = await this.fetchBlockTimestamp(blockNumber);
    this.blockTimes.set(blockNumber, timestamp);
    return timestamp;
  }

  // Implemented per back end.
  async fetchLogPage() { throw new SourceError("not implemented"); }
  async fetchBlockTimestamp() { return null; }
  async getTransaction() { throw new SourceError("not implemented"); }
  async getBlockNumber() { throw new SourceError("not implemented"); }

  /**
   * An address's transactions, newest first. Not every back end can do this —
   * a bare RPC URL cannot — so callers must treat `null` as "unavailable" and
   * degrade rather than fail.
   */
  async getAddressTransactions() { return null; }

  /** Null means "this back end cannot answer", not "there were none". */
  async getTokenTransfers() { return null; }

  /**
   * Can this source actually do a run? Answered before starting one, because
   * finding out mid-scan wastes the reader's time and leaves half a result.
   *
   * Checks two different things: that the endpoint answers at all (a bad API
   * key fails here), and that it will serve a wide historical log query (a
   * pruned or rate-capped public RPC fails here). The second is the one that
   * catches someone pasting a public endpoint into the RPC box.
   */
  async probe() {
    try {
      const height = await this.getBlockNumber();
      if (!height) {
        return { ok: false, message: "The endpoint answered, but not with a block number." };
      }

      // A historical range, far enough back that a pruned node has dropped it.
      const from = Math.max(1, height - 250000);
      try {
        await this.fetchLogPage({
          address: PROBE_ADDRESS,
          topic0: PROBE_TOPIC,
          fromBlock: from,
          toBlock: from + 5000,
        });
      } catch (error) {
        return {
          ok: true,
          archive: false,
          height,
          message: `Connected, but this endpoint will not serve wide historical log queries (${error.message}). Scans need an archive node.`,
        };
      }

      return { ok: true, archive: true, height, message: `Connected. Chain head is block ${height}.` };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }
}

/** Shared by Blockscout and Etherscan, which speak the same v1 query API. */
class EtherscanLikeSource extends Source {
  buildUrl(params) {
    const url = new URL(this.apiUrl);
    for (const [key, value] of Object.entries({ ...this.baseParams, ...params })) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async fetchLogPage({ address, topic0, fromBlock, toBlock }) {
    const body = await this.json(
      this.buildUrl({
        module: "logs",
        action: "getLogs",
        address,
        topic0,
        fromBlock,
        toBlock,
        page: 1,
        offset: PAGE_LIMIT,
      }),
    );

    // "No logs found" is a successful empty result, not an error.
    if (!Array.isArray(body.result)) {
      if (typeof body.result === "string" && /no (logs|records) found/i.test(body.result)) return [];
      if (body.message && /no (logs|records) found/i.test(body.message)) return [];
      throw new SourceError(`Log query failed: ${body.result ?? body.message ?? "unknown error"}`);
    }

    return body.result.map((log) => ({
      address: log.address?.toLowerCase() ?? null,
      blockNumber: toNumber(log.blockNumber),
      timestamp: toNumber(log.timeStamp),
      txHash: log.transactionHash,
      logIndex: toNumber(log.logIndex) ?? 0,
      topics: (log.topics ?? []).filter(Boolean),
      data: log.data ?? "0x",
      // Present on both back ends, and the reason gas fingerprinting is cheap.
      gasPrice: log.gasPrice ? toBigInt(log.gasPrice) : null,
      gasUsed: log.gasUsed ? toBigInt(log.gasUsed) : null,
    }));
  }

  /**
   * ERC-20 transfers touching an address, newest first.
   *
   * Needed to see that someone moved out of a token before depositing and back
   * into it after withdrawing — a conversion the transaction list alone cannot
   * show, because the ETH leg of a swap arrives as an internal transfer.
   */
  async getTokenTransfers(address, { limit = 200 } = {}) {
    const body = await this.json(
      this.buildUrl({
        module: "account",
        action: "tokentx",
        address,
        page: 1,
        offset: limit,
        sort: "desc",
      }),
    );

    if (!Array.isArray(body.result)) return [];

    return body.result.map((transfer) => ({
      hash: transfer.hash,
      blockNumber: toNumber(transfer.blockNumber),
      timestamp: toNumber(transfer.timeStamp),
      from: transfer.from?.toLowerCase() ?? null,
      to: transfer.to?.toLowerCase() ?? null,
      value: toBigInt(transfer.value),
      token: {
        address: transfer.contractAddress?.toLowerCase() ?? null,
        symbol: transfer.tokenSymbol ?? "?",
        decimals: toNumber(transfer.tokenDecimal) ?? 18,
      },
    }));
  }

  async getAddressTransactions(address, { limit = 200 } = {}) {
    const body = await this.json(
      this.buildUrl({
        module: "account",
        action: "txlist",
        address,
        page: 1,
        offset: limit,
        sort: "desc",
      }),
    );

    if (!Array.isArray(body.result)) return [];

    return body.result.map((tx) => ({
      hash: tx.hash,
      from: tx.from?.toLowerCase() ?? null,
      to: tx.to?.toLowerCase() ?? null,
      value: toBigInt(tx.value),
      gasPrice: toBigInt(tx.gasPrice),
      gasLimit: toBigInt(tx.gas),
      gasUsed: toBigInt(tx.gasUsed),
      nonce: toNumber(tx.nonce),
      blockNumber: toNumber(tx.blockNumber),
      timestamp: toNumber(tx.timeStamp),
      position: toNumber(tx.transactionIndex),
      input: tx.input ?? "0x",
      failed: tx.isError === "1",
    }));
  }
}

export class BlockscoutSource extends EtherscanLikeSource {
  constructor({ baseUrl = "https://eth.blockscout.com", ...rest } = {}) {
    super({ minIntervalMs: 210, ...rest });
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiUrl = `${this.baseUrl}/api`;
    this.baseParams = {};
  }

  get label() {
    return `Blockscout (${new URL(this.baseUrl).host})`;
  }

  /**
   * Blockscout's v2 REST endpoint, which carries the 1559 fee fields and the
   * position in block that the v1 API leaves out.
   */
  async getTransaction(hash) {
    // A hash nobody has ever seen is a 404 here, which is an answer ("no such
    // transaction"), not a failure worth showing the reader.
    const tx = await this.json(`${this.baseUrl}/api/v2/transactions/${hash}`).catch((error) => {
      if (error?.status === 404) return null;
      throw error;
    });
    if (!tx || tx.message === "Not found") return null;

    return {
      hash: tx.hash,
      from: tx.from?.hash?.toLowerCase() ?? null,
      to: tx.to?.hash?.toLowerCase() ?? null,
      value: toBigInt(tx.value ?? 0),
      gasPrice: toBigInt(tx.gas_price ?? 0),
      maxFeePerGas: tx.max_fee_per_gas ? toBigInt(tx.max_fee_per_gas) : null,
      maxPriorityFeePerGas: tx.max_priority_fee_per_gas
        ? toBigInt(tx.max_priority_fee_per_gas)
        : null,
      gasLimit: toBigInt(tx.gas_limit ?? 0),
      gasUsed: toBigInt(tx.gas_used ?? 0),
      type: toNumber(tx.type) ?? 0,
      nonce: toNumber(tx.nonce),
      blockNumber: toNumber(tx.block_number ?? tx.block),
      timestamp: tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : null,
      position: toNumber(tx.position),
      input: tx.raw_input ?? "0x",
      method: tx.method ?? null,
      failed: tx.status === "error",
    };
  }

  async getBlock(blockNumber) {
    const block = await this.json(`${this.baseUrl}/api/v2/blocks/${blockNumber}`).catch((error) => {
      if (error?.status === 404) return null;
      throw error;
    });
    if (!block || block.message === "Not found") return null;
    return {
      number: toNumber(block.height),
      timestamp: block.timestamp ? Math.floor(new Date(block.timestamp).getTime() / 1000) : null,
      miner: block.miner?.hash?.toLowerCase() ?? null,
    };
  }

  async fetchBlockTimestamp(blockNumber) {
    return (await this.getBlock(blockNumber))?.timestamp ?? null;
  }

  async getBlockNumber() {
    const body = await this.json(`${this.baseUrl}/api/v2/blocks?type=block`);
    return toNumber(body?.items?.[0]?.height);
  }
}

export class EtherscanSource extends EtherscanLikeSource {
  constructor({ apiKey, chainId = 1, ...rest } = {}) {
    super({ minIntervalMs: 220, ...rest });
    if (!apiKey) throw new SourceError("Etherscan needs an API key — the V2 API rejects keyless calls");
    this.apiUrl = "https://api.etherscan.io/v2/api";
    this.baseParams = { chainid: chainId, apikey: apiKey };
  }

  get label() {
    return "Etherscan";
  }

  async proxy(params) {
    const body = await this.json(this.buildUrl({ module: "proxy", ...params }));
    if (body.error) throw new SourceError(`Etherscan: ${body.error.message ?? "proxy error"}`);
    // A rejected key comes back as HTTP 200 with the complaint in `result`,
    // which would otherwise sail on and fail later as a NaN block number.
    if (body.status === "0" && typeof body.result === "string") {
      throw new SourceError(`Etherscan: ${body.result}`);
    }
    return body.result;
  }

  async getTransaction(hash) {
    const tx = await this.proxy({ action: "eth_getTransactionByHash", txhash: hash });
    if (!tx) return null;
    const receipt = await this.proxy({ action: "eth_getTransactionReceipt", txhash: hash });
    const timestamp = await this.blockTimestamp(toNumber(tx.blockNumber));

    return normaliseRpcTransaction(tx, receipt, timestamp);
  }

  async getBlock(blockNumber) {
    const block = await this.proxy({
      action: "eth_getBlockByNumber",
      tag: `0x${blockNumber.toString(16)}`,
      boolean: "false",
    });
    if (!block) return null;
    return {
      number: toNumber(block.number),
      timestamp: toNumber(block.timestamp),
      miner: block.miner?.toLowerCase() ?? null,
    };
  }

  async fetchBlockTimestamp(blockNumber) {
    return (await this.getBlock(blockNumber))?.timestamp ?? null;
  }

  async getBlockNumber() {
    return toNumber(await this.proxy({ action: "eth_blockNumber" }));
  }
}

export class RpcSource extends Source {
  constructor({ url, ...rest } = {}) {
    super({ minIntervalMs: 60, ...rest });
    if (!url) throw new SourceError("An RPC source needs a URL");
    this.url = url;
  }

  get label() {
    return `RPC (${new URL(this.url).host})`;
  }

  async call(method, params) {
    const body = await this.json(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (body.error) {
      const message = body.error.message ?? "RPC error";
      // Public endpoints answer wide ranges with a range-limit complaint; the
      // splitting in getLogs() only helps if we let it see the failure.
      throw new SourceError(`${method}: ${message}`, {
        retryable: /timeout|rate|busy|limit exceeded/i.test(message),
      });
    }
    return body.result;
  }

  async fetchLogPage({ address, topic0, fromBlock, toBlock }) {
    const logs = await this.call("eth_getLogs", [
      {
        address,
        topics: [topic0],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ]);

    return (logs ?? []).map((log) => ({
      address: log.address?.toLowerCase() ?? null,
      blockNumber: toNumber(log.blockNumber),
      // No timestamp on RPC logs; the scan fills these in per unique block.
      timestamp: null,
      txHash: log.transactionHash,
      logIndex: toNumber(log.logIndex) ?? 0,
      topics: (log.topics ?? []).filter(Boolean),
      data: log.data ?? "0x",
      gasPrice: null,
      gasUsed: null,
    }));
  }

  /**
   * Public RPCs cap the range instead of truncating results, so a failure here
   * means "ask for less" rather than "give up".
   */
  async getLogs(options) {
    try {
      return await super.getLogs(options);
    } catch (error) {
      const { fromBlock, toBlock } = options;
      if (!/range|limit|too many|exceed/i.test(error?.message ?? "") || toBlock <= fromBlock) {
        throw error;
      }
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const [left, right] = [
        await this.getLogs({ ...options, toBlock: mid }),
        await this.getLogs({ ...options, fromBlock: mid + 1 }),
      ];
      return [...left, ...right];
    }
  }

  async getTransaction(hash) {
    const tx = await this.call("eth_getTransactionByHash", [hash]);
    if (!tx) return null;
    const receipt = await this.call("eth_getTransactionReceipt", [hash]);
    const timestamp = await this.blockTimestamp(toNumber(tx.blockNumber));
    return normaliseRpcTransaction(tx, receipt, timestamp);
  }

  async getBlock(blockNumber) {
    const block = await this.call("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]);
    if (!block) return null;
    return {
      number: toNumber(block.number),
      timestamp: toNumber(block.timestamp),
      miner: block.miner?.toLowerCase() ?? null,
    };
  }

  async fetchBlockTimestamp(blockNumber) {
    return (await this.getBlock(blockNumber))?.timestamp ?? null;
  }

  async getBlockNumber() {
    return toNumber(await this.call("eth_blockNumber", []));
  }
}

function normaliseRpcTransaction(tx, receipt, timestamp) {
  return {
    hash: tx.hash,
    from: tx.from?.toLowerCase() ?? null,
    to: tx.to?.toLowerCase() ?? null,
    value: toBigInt(tx.value),
    gasPrice: toBigInt(tx.gasPrice),
    maxFeePerGas: tx.maxFeePerGas ? toBigInt(tx.maxFeePerGas) : null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? toBigInt(tx.maxPriorityFeePerGas) : null,
    gasLimit: toBigInt(tx.gas),
    gasUsed: receipt ? toBigInt(receipt.gasUsed) : 0n,
    type: toNumber(tx.type) ?? 0,
    nonce: toNumber(tx.nonce),
    blockNumber: toNumber(tx.blockNumber),
    timestamp,
    position: toNumber(tx.transactionIndex),
    input: tx.input ?? "0x",
    method: null,
    failed: receipt ? toNumber(receipt.status) === 0 : false,
  };
}

/**
 * Build a source from plain config, so the CLI's flags and the website's form
 * can hand over the same object.
 */
export function createSource(config = {}) {
  const { kind = "blockscout", rpcUrl, apiKey, baseUrl, ...rest } = config;

  if (kind === "rpc") return new RpcSource({ url: rpcUrl, ...rest });
  if (kind === "etherscan") return new EtherscanSource({ apiKey, ...rest });
  return new BlockscoutSource({ baseUrl, ...rest });
}
