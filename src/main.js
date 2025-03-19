import axios from "axios";
import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";
import { FILTER_1_AML_CHECK } from "./utils.js";

const providerUrl =
  "https://eth-mainnet.g.alchemy.com/v2/WMk4zoR-oKpUU5LYitsb1weZAASeAiti";
const provider = new ethers.providers.JsonRpcProvider(providerUrl);

const TORN_CASH_ROUTER = "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b";
const TORN_ADDRESS_100ETH = "0xA160cdAB225685dA1d56aa342Ad8841c3b53f291";
const TORN_ADDRESS_10ETH = "0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF";
const TORN_ADDRESS_1ETH = "0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936";
const TORN_ADDRESS_01ETH = "0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc";
const contractABI = [
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
const recipients = [];

// fetch the txns.
const fetchAllWithdrawlAddresses = async (fromBlock, depositAmount) => {
  console.log(chalk.blue(`Fetching withdrawal transactions...`));

  if (depositAmount == 1e17) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_01ETH);
  } else if (depositAmount == 1e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_1ETH);
  } else if (depositAmount == 10e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_10ETH);
  } else if (depositAmount == 100e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_100ETH);
  } else {
    console.warn(chalk.yellow(`Unsupported deposit amount: ${depositAmount}`));
    return [];
  }
};

// Main function
const main = async () => {
  const depositDetails = await askForDepositDetails();
  const data = await retrieveDepositDetails(depositDetails.transactionHash);

  console.log(chalk.blue("Processing Deposit Details..."));
  console.log(`Transaction Hash: ${depositDetails.transactionHash}`);
  console.log(
    `Number of Transactions with Same Amount: ${depositDetails.numberOfTransactions}`
  );
  console.log(`Up To Block Number: ${depositDetails.upToBlockNumber}`);

  console.log(data);
};

// Ask for Deposit hash
const askForDepositDetails = async () => {
    const provider = new ethers.providers.JsonRpcProvider(providerUrl);

  const questions = [
    {
      type: "input",
      name: "transactionHash",
      message: chalk.green("Enter the deposit transaction hash:"),
      validate: (value) => {
        if (value.length !== 66 || !value.startsWith("0x")) {
          return "Please enter a valid transaction hash.";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "numberOfTransactions",
      message: chalk.green(
        "Enter the number of deposit transactions with the same amount (default is 1):"
      ),
      default: 1,
      validate: (value) => {
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 1) {
          return "Please enter a valid number greater than or equal to 1.";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "upToBlockNumber",
      message: chalk.green(
        "Enter the block number to search up to (default is latest):"
      ),
      default: "latest",
      validate: (value) => {
        if (!/^\d+$/.test(value) && value !== "latest") {
          return "Please enter a valid block number or 'latest'.";
        }
        return true;
      },
    },
  ];

  const answers = await inquirer.prompt(questions);

  // If 'latest' is provided, fetch the latest block number
  if (answers.upToBlockNumber === "latest") {
    const latestBlockNumber = await provider.getBlockNumber();
    answers.upToBlockNumber = latestBlockNumber.toString();
  }
  return {
    transactionHash: answers.transactionHash,
    numberOfTransactions: parseInt(answers.numberOfTransactions),
    upToBlockNumber: answers.upToBlockNumber,
  };
};

const retrieveDepositDetails = async (depositTxHash) => {
  try {
    const tx = await provider.getTransaction(depositTxHash);
    if (!tx) {
      throw new Error(`Transaction not found: ${depositTxHash}`);
    }

    const receipt = await provider.getTransactionReceipt(depositTxHash);
    const block = await provider.getBlock(receipt.blockNumber);

    const gasFee = receipt.gasUsed.mul(tx.gasPrice);

    return {
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gasFee: gasFee,
      blockNumber: receipt.blockNumber,
      blockTimestamp: block.timestamp,
    };
  } catch (error) {
    console.error(chalk.red("Error fetching deposit details:"), error);
    return null;
  }
};

main();
