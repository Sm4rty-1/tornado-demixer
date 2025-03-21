import axios from "axios";
import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  askForDepositDetails,
  getWithdrawlData,
  retrieveDepositDetails,
  getAllTransactions,
  provider,
} from "./utils.js";

// Main function
const main = async () => {
  // fetch deposit details..
  const inputData = await askForDepositDetails();

  // get Depositer Details..
  const data = await retrieveDepositDetails(inputData.transactionHash);

  //
  const depositerTXN = await getAllTransactions(data.from);
  console.log("Depositer Other Transaction:", depositerTXN);

  const withdrawlAddreses = await getWithdrawlData(
    data.blockNumber,
    inputData.upToBlockNumber,
    data.value
  );

  // for each withdrawl address get the txns..
  for (const address of withdrawlAddreses) {
    const withdrawlTXN = await getAllTransactions(address, 2000);
    console.log("Transactions Found:", withdrawlTXN);
  }
};

main();
