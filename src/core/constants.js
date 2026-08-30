/**
 * Chain facts. Everything here was verified against mainnet rather than copied
 * from a list: each pool address below has emitted at least one Withdrawal.
 *
 * Nothing in core/ may import a Node built-in or an npm package — this whole
 * directory is vendored into the website and has to run in a browser too.
 */

/** keccak256("Withdrawal(address,bytes32,address,uint256)") */
export const TOPIC_WITHDRAWAL =
  "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931";

/** keccak256("Deposit(bytes32,uint32,uint256)") */
export const TOPIC_DEPOSIT =
  "0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196";

/** The router most deposits and withdrawals go through after Dec 2021. */
export const ROUTER = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b";

/**
 * Call selectors, verified against real mainnet calldata.
 *
 *   pool.deposit(bytes32 commitment)
 *   router.deposit(address tornado, bytes32 commitment, bytes encryptedNote)
 *   pool.withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient,
 *                 address relayer, uint256 fee, uint256 refund)
 *   router.withdraw(address tornado, bytes proof, ...same tail)
 *
 * On both router calls the pool address is calldata word 0, which is how a
 * deposit transaction reveals which denomination it bought without a trace.
 */
export const SELECTOR_DEPOSIT_POOL = "0xb214faa5";
export const SELECTOR_DEPOSIT_ROUTER = "0x13d98d13";
export const SELECTOR_WITHDRAW_POOL = "0x21a0adb6";
export const SELECTOR_WITHDRAW_ROUTER = "0xb438689f";

/**
 * The pools. `denomination` is in the asset's own units, `value` in base units,
 * because ETH pools are matched against tx value and ERC-20 pools are not.
 *
 * Ordered by asset then size, which is also the order the UI lists them in.
 */
export const POOLS = [
  { id: "eth-0.1", asset: "ETH", denomination: "0.1", decimals: 18, value: 100000000000000000n, address: "0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc" },
  { id: "eth-1", asset: "ETH", denomination: "1", decimals: 18, value: 1000000000000000000n, address: "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936" },
  { id: "eth-10", asset: "ETH", denomination: "10", decimals: 18, value: 10000000000000000000n, address: "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf" },
  { id: "eth-100", asset: "ETH", denomination: "100", decimals: 18, value: 100000000000000000000n, address: "0xa160cdab225685da1d56aa342ad8841c3b53f291" },

  { id: "dai-100", asset: "DAI", denomination: "100", decimals: 18, value: 100000000000000000000n, address: "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3" },
  { id: "dai-1000", asset: "DAI", denomination: "1000", decimals: 18, value: 1000000000000000000000n, address: "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144" },
  { id: "dai-10000", asset: "DAI", denomination: "10000", decimals: 18, value: 10000000000000000000000n, address: "0x07687e702b410fa43f4cb4af7fa097918ffd2730" },
  { id: "dai-100000", asset: "DAI", denomination: "100000", decimals: 18, value: 100000000000000000000000n, address: "0x23773e65ed146a459791799d01336db287f25334" },

  { id: "cdai-5000", asset: "cDAI", denomination: "5000", decimals: 8, value: 500000000000n, address: "0x22aaa7720ddd5388a3c0a3333430953c68f1849b" },
  { id: "cdai-50000", asset: "cDAI", denomination: "50000", decimals: 8, value: 5000000000000n, address: "0x03893a7c7463ae47d46bc7f091665f1893656003" },
  { id: "cdai-500000", asset: "cDAI", denomination: "500000", decimals: 8, value: 50000000000000n, address: "0x2717c5e28cf931547b621a5dddb772ab6a35b701" },
  { id: "cdai-5000000", asset: "cDAI", denomination: "5000000", decimals: 8, value: 500000000000000n, address: "0xd21be7248e0197ee08e0c20d4a96debdac3d20af" },

  { id: "usdc-100", asset: "USDC", denomination: "100", decimals: 6, value: 100000000n, address: "0xd96f2b1c14db8458374d9aca76e26c3d18364307" },
  { id: "usdc-1000", asset: "USDC", denomination: "1000", decimals: 6, value: 1000000000n, address: "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d" },

  { id: "usdt-100", asset: "USDT", denomination: "100", decimals: 6, value: 100000000n, address: "0x169ad27a470d064dede56a2d3ff727986b15d52b" },
  { id: "usdt-1000", asset: "USDT", denomination: "1000", decimals: 6, value: 1000000000n, address: "0x0836222f2b2b24a3f36f98668ed8f0b38d1a872f" },

  { id: "wbtc-0.1", asset: "WBTC", denomination: "0.1", decimals: 8, value: 10000000n, address: "0x178169b423a011fff22b9e3f3abea13414ddd0f1" },
  { id: "wbtc-1", asset: "WBTC", denomination: "1", decimals: 8, value: 100000000n, address: "0x610b717796ad172b316836ac95a2ffad065ceab4" },
  { id: "wbtc-10", asset: "WBTC", denomination: "10", decimals: 8, value: 1000000000n, address: "0xbb93e510bbcd0b7beb5a853875f9ec60275cf498" },
];

const POOL_BY_ADDRESS = new Map(POOLS.map((pool) => [pool.address, pool]));
const POOL_BY_ID = new Map(POOLS.map((pool) => [pool.id, pool]));

export function poolByAddress(address) {
  return address ? POOL_BY_ADDRESS.get(address.toLowerCase()) ?? null : null;
}

export function poolById(id) {
  return POOL_BY_ID.get(id) ?? null;
}

/** The pool whose denomination equals an ETH deposit's value, if any. */
export function poolByValue(value) {
  const wei = BigInt(value);
  return POOLS.find((pool) => pool.asset === "ETH" && pool.value === wei) ?? null;
}

/**
 * Addresses that are never a useful "counterparty" — they are the protocol
 * itself, so seeing one on both sides of a link means nothing.
 */
export const PROTOCOL_ADDRESSES = new Set([ROUTER, ...POOLS.map((pool) => pool.address)]);

/** Mainnet averages ~12s per block post-merge; used to turn a time window into blocks. */
export const SECONDS_PER_BLOCK = 12;

/**
 * Addresses so widely used that sharing them says nothing about identity.
 *
 * This is a judgement list, not a measurement, and it is deliberately short:
 * the point is to stop the obvious false positives (everybody swaps on Uniswap,
 * everybody holds USDC) without pretending to know the popularity of the long
 * tail. Anything not listed is treated as distinctive, which is the assumption
 * that fails safe — a rare contract in common between two addresses is worth
 * looking at even if it turns out to be popular.
 */
export const COMMON_CONTRACTS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 router
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 router
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap universal router
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap universal router 2
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v5
  "0x1111111254fb6c44bac0bed2854e76f90643097d", // 1inch v4
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x exchange proxy
  "0x881d40237659c251811cec9c364ef91dc08d300c", // MetaMask swap router
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
]);

/**
 * Tokens held by a large share of all addresses. A shared position in one of
 * these is weak evidence; a shared position in something obscure is not.
 */
export const COMMON_TOKENS = new Set([
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
]);
