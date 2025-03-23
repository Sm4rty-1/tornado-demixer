import axios from "axios";
import chalk from "chalk";
import { getTransactionPositionInBlock, getTxnData } from "./utils.js";

export const checkAML = async (address) => {
  try {
    const url = `https://monetory.io/api/v2/crypto_address_check?crypto_address=${address}`;
    const response = await axios.get(url, {
      headers: { "user-agent": "bob" },
    });

    if (response.data?.is_ok && response.data?.data?.length === 0) {
      console.log(chalk.greenBright(`Wallet ${address} is not suspicious.`));

      return false;
    }

    console.log(chalk.yellow(`Wallet ${address} is flagged as suspicious.`));
    return true;
  } catch (error) {
    console.error(chalk.red(`AML Check Failed for ${address}:`), error.message);
    return false;
  }
};

export const ADV_FILTER_00_TIME_CHECK = async (depositData, withdrawData) => {
  const depositTime = new Date(depositData.blockTimestamp * 1000).getUTCHours();
  const withdrawTime = new Date(
    withdrawData.blockTimestamp * 1000
  ).getUTCHours();

  // Define the suspicious time range (e.g., within 2 hours before or 2 hours after deposit time)
  const suspiciousStart = (depositTime - 2 + 24) % 24; // Handle negative hours
  const suspiciousEnd = (depositTime + 2) % 24;

  const isSuspicious =
    (withdrawTime >= suspiciousStart && withdrawTime <= suspiciousEnd) ||
    (suspiciousStart > suspiciousEnd &&
      (withdrawTime >= suspiciousStart || withdrawTime <= suspiciousEnd));

  console.log(
    isSuspicious
      ? chalk.yellow(
          `Address: ${withdrawData.from} Suspicious time frame detected: Deposit at ${depositTime} UTC, Withdrawal at ${withdrawTime} UTC`
        )
      : chalk.green(
          `Address: ${withdrawData.from} No suspicious time frame: Deposit at ${depositTime} UTC, Withdrawal at ${withdrawTime} UTC`
        )
  );

  return isSuspicious;
};

export const ADV_FILTER_01_TXN_TYPE = async (depositData, withdrawData) => {
  const depositorType = depositData.type;
  const withdrawerType = withdrawData.type;

  const result = depositorType === withdrawerType;

  console.log(
    result
      ? chalk.green(`Address: ${withdrawData.from} Transaction types match: ${depositorType}.`)
      : chalk.red(`Address: ${withdrawData.from} Transaction types do not match: ${depositorType} vs ${withdrawerType}.`)
  );

  return result;
};

export const ADV_FILTER_02_BLOCK_POSITION = async (depositData, withdrawData) => {
  const depositorBlock = await getTransactionPositionInBlock(depositData.transactionHash);
  const withdrawerBlock = await getTransactionPositionInBlock(withdrawData.transactionHash);

  const positionDifference = Math.abs(depositorBlock - withdrawerBlock);
  const result = positionDifference <= 60;

  console.log(
    result
      ? chalk.green(`Address: ${withdrawData.from} Block position difference is within the allowed range: ${positionDifference}.`)
      : chalk.red(`Address: ${withdrawData.from} Block position difference exceeds the allowed range: ${positionDifference}.`)
  );

  return result;
};

export const ADV_FILTER_03_BUILDER = async (depositData, withdrawData) => {
  const depositorBuilder = depositData.miner;
  const withdrawerBuilder = withdrawData.miner;

  const result = depositorBuilder === withdrawerBuilder;

  console.log(
    result
      ? chalk.green(`Address: ${withdrawData.from} Builders match: ${depositorBuilder}.`)
      : chalk.red(`Address: ${withdrawData.from} Builders do not match: ${depositorBuilder} vs ${withdrawerBuilder}.`)
  );

  return result;
};

export const ADV_FILTER_04_GAS_FEES = async (depositData, withdrawData) => {
  const depositorGasFee = depositData.gasFee;
  const withdrawerGasFee = withdrawData.gasFee;

  const gasFeeDifference = Math.abs(depositorGasFee - withdrawerGasFee);
  const allowedDifference = depositorGasFee * 0.2; // Allow 20% difference
  const result = gasFeeDifference <= allowedDifference;

  console.log(
    result
      ? chalk.green(`Address: ${withdrawData.from} Gas fee difference is within the allowed range: ${gasFeeDifference}.`)
      : chalk.red(`Address: ${withdrawData.from} Gas fee difference exceeds the allowed range: ${gasFeeDifference}.`)
  );

  return result;
};

export const applyFilters = async (
  filterType,
  depositTxnHash,
  uniqueWithdrawalData
) => {
  let filteredData = uniqueWithdrawalData;

  if (filterType === "ADV_FILTER_00_TIME_CHECK") {
    console.log(chalk.blue("Applying FILTER 1 (Time Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = [];

    for (const data of uniqueWithdrawalData) {
      const withdrawalData = await getTxnData(data.transactionHash);
      const isSuspicious = await ADV_FILTER_00_TIME_CHECK(depositorData, withdrawalData);
      if (isSuspicious) {
        filteredData.push(data);
      }
    }
    return filteredData;
  }

  if (filterType === "ADV_FILTER_01_TXN_TYPE") {
    console.log(chalk.blue("Applying FILTER 2 (Transaction Type)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = [];

    for (const data of uniqueWithdrawalData) {
      const withdrawalData = await getTxnData(data.transactionHash);
      const isSuspicious = await ADV_FILTER_01_TXN_TYPE(depositorData, withdrawalData);
      if (isSuspicious) {
        filteredData.push(data);
      }
    }

    return filteredData;
  }

  if (filterType === "ADV_FILTER_02_BLOCK_POSITION") {
    console.log(chalk.blue("Applying FILTER 3 (Block Position)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = [];

    for (const data of uniqueWithdrawalData) {
      const withdrawalData = await getTxnData(data.transactionHash);
      const isSuspicious = await ADV_FILTER_02_BLOCK_POSITION(depositorData, withdrawalData);
      if (isSuspicious) {
        filteredData.push(data);
      }
    }

    return filteredData;
  }

  if (filterType === "ADV_FILTER_03_BUILDER") {
    console.log(chalk.blue("Applying FILTER 4 (Builder Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = [];

    for (const data of uniqueWithdrawalData) {
      const withdrawalData = await getTxnData(data.transactionHash);
      const isSuspicious = await ADV_FILTER_03_BUILDER(depositorData, withdrawalData);
      if (isSuspicious) {
        filteredData.push(data);
      }
    }

    return filteredData;
  }

  if (filterType === "ADV_FILTER_04_GAS_FEES") {
    console.log(chalk.blue("Applying FILTER 5 (Gas Fees Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = [];

    for (const data of uniqueWithdrawalData) {
      const withdrawalData = await getTxnData(data.transactionHash);
      const isSuspicious = await ADV_FILTER_04_GAS_FEES(depositorData, withdrawalData);
      if (isSuspicious) {
        filteredData.push(data);
      }
    }

    return filteredData;
  }
};
