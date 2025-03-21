import chalk from "chalk";
import {
  askForDepositDetails,
  getWithdrawlData,
  getTxnData,
  getAllTransactions,
  provider,
} from "./utils.js";
import { FILTER_1_AML_CHECK, FILTER_2_TIME_CHECK, AdvancedFilter } from "./filter.js";

// Main function
const main = async () => {
  const inputData = await askForDepositDetails();
  const depositData = await getTxnData(inputData.transactionHash);

  const depositerTxns = await getAllTransactions(depositData.from);
  console.log("Depositer Other Transactions:", depositerTxns);

  const withdrawlAddresses = await getWithdrawlData(
    depositData.blockNumber,
    inputData.upToBlockNumber,
    depositData.value
  );

  const suspiciousAddresses = [];

  for (const address of withdrawlAddresses) {
    const withdrawlTxns = await getAllTransactions(address);

    for (const withdrawlTxn of withdrawlTxns) {
      const amlCheck = await FILTER_1_AML_CHECK(address);
      const timeCheck = await FILTER_2_TIME_CHECK(inputData.transactionHash, withdrawlTxn);
      const advancedCheck = await AdvancedFilter(inputData.transactionHash, withdrawlTxn);

      if (amlCheck && timeCheck && advancedCheck) {
        suspiciousAddresses.push(address);
      }
    }
  }

  console.log(chalk.cyan("Suspicious Addresses:"));
  suspiciousAddresses.forEach((address, index) => {
    console.log(chalk.whiteBright(`${index + 1}. ${address}`));
  });
};

main();
