import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  providerUrl,
  contractABI,
  TORN_ADDRESS_01ETH,
  TORN_ADDRESS_1ETH,
  TORN_ADDRESS_10ETH,
  TORN_ADDRESS_100ETH,
  EXCLUDED_ADDRESSES,
} from "./const.js";
import { Alchemy, Network } from "alchemy-sdk";

const settings = {
  apiKey: "pd0Qv7635Nc0SB7kyAsE4GbxSDwVFqRR", // Replace with your Alchemy API Key.
  network: Network.ETH_MAINNET, // Replace with your network.
};
const alchemy = new Alchemy(settings);

export const provider = new ethers.providers.JsonRpcProvider(providerUrl);

export const getTxnData = async (depositTxHash) => {
  try {
    const tx = await provider.getTransaction(depositTxHash);
    if (!tx) {
      throw new Error(`Transaction not found: ${depositTxHash}`);
    }

    const receipt = await provider.getTransactionReceipt(depositTxHash);
    const block = await provider.getBlock(receipt.blockNumber);

    const gasFee = receipt.gasUsed.mul(tx.gasPrice);

    return {
      transactionHash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      type: tx.type,
      gasPrice: tx.gasPrice.toString(),
      gasLimit: tx.gasLimit.toString(),
      gasUsed: receipt.gasUsed.toString(),
      gasFee: gasFee.toString(),
      nonce: tx.nonce,
      data: tx.data,
      chainId: tx.chainId,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      blockTimestamp: block.timestamp,
      miner: block.miner,
      transactionIndex: receipt.transactionIndex,
      logs: receipt.logs,
      status: receipt.status,
    };
  } catch (error) {
    console.error(chalk.red("Error fetching transaction details:"));
    return null;
  }
};

export const askForDepositDetails = async () => {
  const provider = new ethers.providers.JsonRpcProvider(providerUrl);

  const questions = [
    {
      type: "input",
      name: "transactionHash",
      message: chalk.green("Enter the deposit transaction hash:"),
      default:
        "0xa62f69b29b866307afd4ea5b930df39c44009c842c4b61da0e80bbb7e33fa105",
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

  if (answers.upToBlockNumber === "latest") {
    const latestBlockNumber = await provider.getBlockNumber();
    answers.upToBlockNumber = Number(latestBlockNumber.toString());
  }
  return {
    transactionHash: answers.transactionHash,
    numberOfTransactions: parseInt(answers.numberOfTransactions),
    upToBlockNumber: answers.upToBlockNumber,
  };
};

export const getWithdrawlData = async (fromBlock, toBlock, depositAmount) => {
  console.log(chalk.blue(`Fetching withdrawal transactions...\n`));

  let tornadoCashAddress;
  if (depositAmount == 1e17) {
    tornadoCashAddress = TORN_ADDRESS_01ETH;
  } else if (depositAmount == 1e18) {
    tornadoCashAddress = TORN_ADDRESS_1ETH;
  } else if (depositAmount == 10e18) {
    tornadoCashAddress = TORN_ADDRESS_10ETH;
  } else if (depositAmount == 100e18) {
    tornadoCashAddress = TORN_ADDRESS_100ETH;
  } else {
    console.warn(chalk.yellow(`Unsupported deposit amount: ${depositAmount}`));
    return [];
  }

  const logs = await provider.getLogs({
    address: tornadoCashAddress,
    fromBlock: ethers.utils.hexValue(fromBlock),
    toBlock: ethers.utils.hexValue(toBlock),
    topics: [
      "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931",
    ],
  });

  const withdrawalData = [];
  for (const log of logs) {
    const recipient = await extractRecipientFromTransaction(log.transactionHash);
    if (recipient) {
      withdrawalData.push({
        recipient,
        transactionHash: log.transactionHash,
      });
    }
  }
  return withdrawalData;
};

export const extractRecipientFromTransaction = async (hash) => {
  try {
    const iface = new ethers.utils.Interface(contractABI);
    const transaction = await provider.getTransaction(hash);
    if (!transaction) {
      console.warn(chalk.yellow(`Transaction not found: ${hash}`));
      return null;
    }
    const decodedData = iface.parseTransaction({ data: transaction.data });
    return decodedData.args[4];
  } catch (error) {
    return null;
  }
};

export const getDepositerTransactions = async (walletAddress, excludedAddresses = EXCLUDED_ADDRESSES) => {
  console.log(chalk.blue(`Fetching the latest transaction for wallet: ${walletAddress}`));

  try {
    const response = await alchemy.core.getAssetTransfers({
      fromAddress: walletAddress,
      category: ["external", "internal", "erc20"],
      order: "desc", // Fetch the latest transactions first
      maxCount: 1, // Limit to the latest transaction
    });

    if (response.transfers.length === 0) {
      console.log(chalk.yellow(`No transactions found for wallet: ${walletAddress}`));
      return null;
    }

    const latestTransaction = response.transfers.find(
      (txn) => !excludedAddresses.includes(txn.to)
    );

    if (!latestTransaction) {
      console.log(chalk.yellow(`No valid transactions found for wallet: ${walletAddress}`));
      return null;
    }

    return latestTransaction.hash;
  } catch (error) {
    console.error(chalk.red(`Error fetching transactions for wallet: ${walletAddress}`), error);
    return null;
  }
};

export const getTransactionPositionInBlock = async (txnHash) => {
  try {
    const txn = await provider.getTransaction(txnHash);
    if (!txn) return console.log(chalk.yellow(`Transaction not found: ${txnHash}`)), null;
    return txn.transactionIndex;
  } catch (error) {
    // console.error(chalk.red(`Error fetching transaction: ${txnHash}`), error);
    return null;
  }
};