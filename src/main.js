import {
  askForDepositDetails,
  getWithdrawlData,
  getTxnData,
  getDepositerTransactions,
} from "./utils.js";
import { applyFilters, checkAML } from "./filter.js";
import chalk from "chalk";
import inquirer from "inquirer"; // For interactive console

// Main function
const main = async () => {
  // Fetch deposit details
  const inputData = await askForDepositDetails();

  // Get depositor details
  const depositerData = await getTxnData(inputData.transactionHash);

  // Get other transactions of depositor
  const depositerTXN = await getDepositerTransactions(depositerData.from);
  console.log(chalk.blue("Depositor's Transactions:"), depositerTXN);

  // Get all withdrawal data (addresses and transaction hashes)
  const allWithdrawlTransactions = await getWithdrawlData(
    depositerData.blockNumber,
    inputData.upToBlockNumber,
    depositerData.value
  );

  if (allWithdrawlTransactions.length === 0) {
    console.log(chalk.yellow("No withdrawal transactions found."));
    return;
  }

  // Filter unique wallet addresses mapped to transaction hashes
  const uniqueAddressMap = new Map();
  for (const transaction of allWithdrawlTransactions) {
    if (!uniqueAddressMap.has(transaction.recipient)) {
      uniqueAddressMap.set(transaction.recipient, transaction.transactionHash);
    }
  }

  const uniqueWithdrawalData = Array.from(uniqueAddressMap, ([recipient, transactionHash]) => ({
    recipient,
    transactionHash,
  }));

  console.log(chalk.cyan("Unique Suspicious Withdrawal Transactions:"));
  uniqueWithdrawalData.forEach((data, index) =>
    console.log(
      chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}, Hash: ${data.transactionHash}`)
    )
  );
  console.log();

  // Perform AML checks by default
  console.log(chalk.blue("Performing AML checks on all withdrawal addresses..."));
  const amlCheckedData = [];
  for (const data of uniqueWithdrawalData) {
    const isSuspicious = await checkAML(data.recipient);
    if (isSuspicious) {
      amlCheckedData.push(data);
    }
  }

  if (amlCheckedData.length === 0) {
    console.log(chalk.yellow("No suspicious wallets found after AML checks."));
    console.log();
  } else {
    console.log(chalk.cyan("Suspicious Withdrawal Transactions after AML Check:"));
    amlCheckedData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}, Hash: ${data.transactionHash}`)
      )
    );
  }

  // Initialize filteredData with uniqueWithdrawalData for interactive filters
  let filteredData = uniqueWithdrawalData;

  while (true) {
    const { filterType } = await inquirer.prompt([
      {
        type: "list",
        name: "filterType",
        message: "Select a filter to apply:",
        choices: [
          { name: "FILTER 1 (Time Check)", value: "ADV_FILTER_00_TIME_CHECK" },
          { name: "FILTER 2 (Transaction Type)", value: "ADV_FILTER_01_TXN_TYPE" },
          { name: "FILTER 3 (Block Position)", value: "ADV_FILTER_02_BLOCK_POSITION" },
          { name: "FILTER 4 (Builder Check)", value: "ADV_FILTER_03_BUILDER" },
          { name: "FILTER 5 (Gas Fees Check)", value: "ADV_FILTER_04_GAS_FEES" },
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    if (filterType === "exit") {
      console.log(chalk.green("Exiting the filtering process."));
      break;
    }

    console.log(chalk.blue(`Applying ${filterType}...`));
    filteredData = await applyFilters(filterType, depositerData.transactionHash, filteredData);

    if (filteredData.length === 0) {
      console.log(chalk.red("No data returned from selected filter."));
      break;
    }

    console.log();
    console.log(chalk.green("Filtered Data:"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.white(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    // Wait for user input before returning to the main menu
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: "Press any key to return to the filter selection screen...",
      },
    ]);
    console.log();
    filteredData = uniqueWithdrawalData;
  }
};

main();
