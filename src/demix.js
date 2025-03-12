import axios from "axios";
import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";

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
      "inputs": [
        {"internalType":"address","name":"_token","type":"address"},
        {"internalType":"bytes32","name":"_commitment","type":"bytes32"},
        {"internalType":"uint32","name":"_index","type":"uint32"}
      ],
      "name":"deposit",
      "outputs":[],
      "stateMutability":"nonpayable",
      "type":"function"
    },
    {
      "inputs": [
        {"internalType":"address","name":"_tornado","type":"address"},
        {"internalType":"bytes","name":"_proof","type":"bytes"},
        {"internalType":"bytes32","name":"_root","type":"bytes32"},
        {"internalType":"bytes32","name":"_nullifierHash","type":"bytes32"},
        {"internalType":"address","name":"_recipient","type":"address"},
        {"internalType":"address","name":"_relayer","type":"address"},
        {"internalType":"uint256","name":"_fee","type":"uint256"},
        {"internalType":"uint256","name":"_refund","type":"uint256"}
      ],
      "name":"withdraw",
      "outputs":[],
      "stateMutability":"nonpayable",
      "type":"function"
    }
  ];
  const recipients = [];

const checkAddressAgainstAML = async (cryptoAddress) => {
  try {
    const url = `https://monetory.io/api/v2/crypto_address_check?crypto_address=${cryptoAddress}`;
    const response = await axios.get(url, {
      headers: { "user-agent": "bob" },
    });
    if (response.data) {
      return response.data.is_ok;
    }
    return null;
  } catch (error) {
    console.error(chalk.red(`AML Check Failed for ${cryptoAddress}:`), error.message);
    return null;
  }
};

const identifyDemixedWithdrawals = async (withdrawals) => {
  const suspiciousWithdrawals = [];

  for (const withdrawal of withdrawals) {
    const isClean = await checkAddressAgainstAML(withdrawal);
    if (isClean === false) {
      suspiciousWithdrawals.push(withdrawal);
    }
  }

  return suspiciousWithdrawals;
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

const extractRecipientFromTransaction = async (hash) => {
  try {
    const iface = new ethers.utils.Interface(contractABI);
    const transaction = await provider.getTransaction(hash);
    if (!transaction) {
      console.warn(chalk.yellow(`Transaction not found: ${hash}`));
      return null;
    }
    const decodedData = iface.parseTransaction({ data: transaction.data });
    // console.log(decodedData.args[4]);
    return decodedData.args[4];
  } catch (error) {
    // console.error(chalk.red(`Error decoding transaction ${hash}:`), error);
    return null;
  }
};

async function fetchWithdrawalRecipients(fromBlock, tornadoCashAddress) {
    const toBlock = await provider.getBlockNumber();
    const recipients = new Set(); // Use a Set to automatically remove duplicates
  
    const logs = await provider.getLogs({
      address: tornadoCashAddress,
      fromBlock: ethers.utils.hexValue(fromBlock),
      toBlock: ethers.utils.hexValue(toBlock),
      topics: [
        "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931",
      ],
    });
  
    for (const log of logs) {
      const recipient = await extractRecipientFromTransaction(log.transactionHash);
      if (recipient) {
        // console.log(chalk.green(`Recipient found for transaction ${log.transactionHash}: ${recipient}`));
        recipients.add(recipient); // Add recipient to the Set
      } else {
        // console.log(chalk.yellow(`No recipient found for transaction ${log.transactionHash}`));
      }
    }
    console.log();
    console.log(chalk.cyan(`Suspicious Recipients (Unique):`), Array.from(recipients));
    return Array.from(recipients); // Convert Set back to Array for return
  }
  

const retrieveWithdrawalTransactions = async (fromBlock, depositAmount) => {
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

const analyzeTornadoCashDeposit = async (depositHash) => {
  console.log(chalk.green.bold("Starting Tornado Cash Deposit Analysis...\n"));

  const depositDetails = await retrieveDepositDetails(depositHash);

  if (!depositDetails) {
    console.error(chalk.red("Failed to retrieve deposit details."));
    return;
  }

  console.log(chalk.cyan("Deposit Wallet:"), depositDetails.from);
  console.log(
    chalk.cyan("Deposit Amount:"),
    (depositDetails.value / 1e18).toString(),
    "ETH"
  );
  console.log(chalk.cyan("Deposit Time:"), new Date(depositDetails.blockTimestamp * 1000).toLocaleString());
  console.log(chalk.cyan("Deposit Block Number:"), depositDetails.blockNumber);

  const isDepositerClean = await checkAddressAgainstAML(depositDetails.from);
  console.log();
  if (isDepositerClean === true) {
    console.log(chalk.green("The Deposit wallet is not present in AML List."));
  } else if (isDepositerClean === false) {
    console.log(chalk.red("The Deposit wallet is present in AML List."));
  } else {
    console.warn(
      chalk.yellow("Could not determine AML status for the deposit wallet.")
    );
  }

  const withdrawalAddresses = await retrieveWithdrawalTransactions(
    depositDetails.blockNumber,
    depositDetails.value
  );

  if (withdrawalAddresses.length === 0) {
    console.warn(
      chalk.yellow("No withdrawal transactions found for this deposit.")
    );
    return;
  }

  const suspiciousAddresses = await identifyDemixedWithdrawals(
    withdrawalAddresses
  );

  if (suspiciousAddresses.length > 0) {
    console.warn(
      chalk.red.bold(
        "\nIdentified Suspicious Withdrawal Addresses (Present in AML List):"
      )
    );
    suspiciousAddresses.forEach((address) => console.log(chalk.red(address)));
    return suspiciousAddresses;
  } else {
    console.log(
      chalk.green.bold("\nIdentified Suspicious Withdrawal Addresses was not present in AML list.")
    );
    return [];
  }
};

const askForDepositHash = async () => {
  const questions = [
    {
      type: "input",
      name: "depositHash",
      message: chalk.green("Enter the deposit transaction hash:"),
      validate: (value) => {
        if (value.length !== 66 || !value.startsWith("0x")) {
          return "Please enter a valid transaction hash.";
        }
        return true;
      },
    },
  ];

  const answer = await inquirer.prompt(questions);
  return answer.depositHash;
};

const main = async () => {
  const depositHash = await askForDepositHash();
  if (depositHash) {
    await analyzeTornadoCashDeposit(depositHash);
  }
};

main();
