import axios from "axios";
import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  askForDepositDetails,
  getWithdrawlData,
  getTxnData,
  getAllTransactions,
  provider,
} from "./utils.js";
import {
  FILTER_1_AML_CHECK,
  FILTER_2_TIME_CHECK,
  AdvancedFilter,
} from "./filter.js";

// Main function
const main = async () => {
  // fetch deposit details..
  const inputData = await askForDepositDetails();

  // get Depositer Details..
  const depositerData = await getTxnData(inputData.transactionHash);

  // get other transactions of depositer..
  const depositerTXN = await getAllTransactions(depositerData.from);
  console.log("Depositer Other Transaction:", depositerTXN);

  // get all withdaw address. 
  const withdrawlAddreses = await getWithdrawlData(
    depositerData.blockNumber,
    inputData.upToBlockNumber,
    depositerData.value
  );

  // for each withdrawl address get the txns and store it. 
  for (const address of withdrawlAddreses) {
    const withdrawlTXN = await getAllTransactions(address, 2000);
    console.log("Transactions Found:", withdrawlTXN);
  }

  // use depositer txn, and withdrawl txn to filter out the transactions.
  // we will have final withdrawlAddreses after all the filters.
  const finalWithdrawlAddreses = [];
  

};

main();
