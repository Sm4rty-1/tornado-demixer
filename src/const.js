export const providerUrl = "https://eth-mainnet.g.alchemy.com/v2/WMk4zoR-oKpUU5LYitsb1weZAASeAiti";
export const TORN_CASH_ROUTER = "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b";
export const TORN_ADDRESS_100ETH = "0xA160cdAB225685dA1d56aa342Ad8841c3b53f291";
export const TORN_ADDRESS_10ETH = "0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF";
export const TORN_ADDRESS_1ETH = "0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936";
export const TORN_ADDRESS_01ETH = "0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc";

export const EXCLUDED_ADDRESSES = [
  TORN_CASH_ROUTER,
  TORN_ADDRESS_100ETH,
  TORN_ADDRESS_10ETH,
  TORN_ADDRESS_1ETH,
  TORN_ADDRESS_01ETH,
];

export const contractABI = [
  {
    inputs: [
      { internalType: "address", name: "_token", type: "address" },
      { internalType: "bytes32", name: "_commitment", type: "bytes32" },
      { internalType: "uint32", name: "_index", type: "uint32" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_tornado", type: "address" },
      { internalType: "bytes", name: "_proof", type: "bytes" },
      { internalType: "bytes32", name: "_root", type: "bytes32" },
      { internalType: "bytes32", name: "_nullifierHash", type: "bytes32" },
      { internalType: "address", name: "_recipient", type: "address" },
      { internalType: "address", name: "_relayer", type: "address" },
      { internalType: "uint256", name: "_fee", type: "uint256" },
      { internalType: "uint256", name: "_refund", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];