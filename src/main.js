import {
  askForDepositDetails,
  getWithdrawlData,
  getTxnData,
  getDepositerTransactions,
} from "./utils.js";
import { applyFilters } from "./filter.js";
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
      chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}, Hash: ${data.transactionHash}\n\n`)
    )
  );

  // Interactive console for applying filters
  let filteredData = uniqueWithdrawalData;
  while (true) {
    const { filterType } = await inquirer.prompt([
      {
        type: "list",
        name: "filterType",
        message: "Select a filter to apply:",
        choices: [
          { name: "FILTER 1 (AML Check)", value: "FILTER_1_AML_CHECK" },
          { name: "FILTER 2 (Time Check)", value: "FILTER_2_TIME_CHECK" },
          { name: "FILTER 3 (Transaction Type)", value: "ADV_FILTER_01_TXN_TYPE" },
          { name: "FILTER 4 (Block Position)", value: "ADV_FILTER_02_BLOCK_POSITION" },
          { name: "FILTER 5 (Builder Check)", value: "ADV_FILTER_03_BUILDER" },
          { name: "FILTER 6 (Gas Fees Check)", value: "ADV_FILTER_04_GAS_FEES" },
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
      console.log(chalk.red("No data passed the selected filter."));
      break;
    }

    console.log(chalk.green("Filtered Data:"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}, Hash: ${data.transactionHash}`)
      )
    );
  }
};

main();
