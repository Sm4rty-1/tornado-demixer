import axios from "axios";
import chalk from "chalk";
import {
  getTransactionPositionInBlock,
  getTxnData
} from "./utils.js";

export const BasicFilter = async (depositTxnHash, uniqueWithdrawalData) => {
  const depositorData = await getTxnData(depositTxnHash);
  const filteredData = [];

  for (const { recipient, transactionHash } of uniqueWithdrawalData) {
    const withdrawalData = await getTxnData(transactionHash);
    if (!withdrawalData) continue;

    const amlCheck = await FILTER_1_AML_CHECK(recipient);
    const timeCheck = await FILTER_2_TIME_CHECK(depositorData, withdrawalData);

    if (amlCheck && timeCheck) {
      filteredData.push({ recipient, transactionHash });
    }
  }

  console.log(chalk.cyan("Data after Basic Filter:"));
  filteredData.forEach((data, index) =>
    console.log(
      chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
    )
  );

  return filteredData;
};

export const AdvancedFilter = async (depositTxnHash, uniqueWithdrawalData) => {
  const depositorData = await getTxnData(depositTxnHash);
  const filteredData = [];

  for (const { recipient, transactionHash } of uniqueWithdrawalData) {
    const withdrawalData = await getTxnData(transactionHash);
    if (!withdrawalData) continue;

    const depositorBlock = await getTransactionPositionInBlock(depositTxnHash);
    const withdrawerBlock = await getTransactionPositionInBlock(transactionHash);

    const txnTypeCheck = await ADV_FILTER_01_TXN_TYPE(
      depositorData.type,
      withdrawalData.type
    );
    const blockPositionCheck = await ADV_FILTER_02_BLOCK_POSITION(
      depositorBlock,
      withdrawerBlock
    );
    const builderCheck = await ADV_FILTER_03_BUILDER(
      depositorData.miner,
      withdrawalData.miner
    );
    const gasFeesCheck = await ADV_FILTER_04_GAS_FEES(
      depositorData.gasFee,
      withdrawalData.gasFee
    );

    if (txnTypeCheck && blockPositionCheck && builderCheck && gasFeesCheck) {
      filteredData.push({ recipient, transactionHash });
    }
  }

  console.log(chalk.cyan("Data after Advanced Filter:"));
  filteredData.forEach((data, index) =>
    console.log(
      chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
    )
  );

  return filteredData;
};

export const FILTER_1_AML_CHECK = async (address) => {
  try {
    const url = `https://monetory.io/api/v2/crypto_address_check?crypto_address=${address}`;
    const response = await axios.get(url, {
      headers: { "user-agent": "bob" },
    });

    if (response.data?.is_ok && response.data?.data?.length === 0) {
      console.log(chalk.green(`Wallet ${address} is not suspicious.`));
      return false;
    }

    console.log(chalk.yellow(`Wallet ${address} is flagged as suspicious.`));
    return true;
  } catch (error) {
    console.error(chalk.red(`AML Check Failed for ${address}:`), error.message);
    return false;
  }
};

export const FILTER_2_TIME_CHECK = async (depositData, withdrawData) => {
  const timeDifference = Math.abs(
    withdrawData.blockTimestamp - depositData.blockTimestamp
  );
  const allowedTimeRange = 2 * 60 * 60; // 2 hours in seconds
  const result = timeDifference <= allowedTimeRange;

  console.log(
    result
      ? chalk.green(`Time difference is within the allowed range for withdrawal.`)
      : chalk.red(`Time difference exceeds the allowed range for withdrawal.`)
  );

  return result;
};

export const ADV_FILTER_01_TXN_TYPE = async (depositorType, withdrawerType) => {
  const result = depositorType === withdrawerType;

  console.log(
    result
      ? chalk.green(`Transaction types match: ${depositorType}.`)
      : chalk.red(`Transaction types do not match: ${depositorType} vs ${withdrawerType}.`)
  );

  return result;
};

export const ADV_FILTER_02_BLOCK_POSITION = async (
  depositorBlock,
  withdrawerBlock
) => {
  const positionDifference = Math.abs(depositorBlock - withdrawerBlock);
  const result = positionDifference <= 60;

  console.log(
    result
      ? chalk.green(`Block position difference is within the allowed range: ${positionDifference}.`)
      : chalk.red(`Block position difference exceeds the allowed range: ${positionDifference}.`)
  );

  return result;
};

export const ADV_FILTER_03_BUILDER = async (
  depositorBuilder,
  withdrawerBuilder
) => {
  const result = depositorBuilder === withdrawerBuilder;

  console.log(
    result
      ? chalk.green(`Builders match: ${depositorBuilder}.`)
      : chalk.red(`Builders do not match: ${depositorBuilder} vs ${withdrawerBuilder}.`)
  );

  return result;
};

export const ADV_FILTER_04_GAS_FEES = async (
  depositorGasFee,
  withdrawerGasFee
) => {
  const gasFeeDifference = Math.abs(depositorGasFee - withdrawerGasFee);
  const allowedDifference = depositorGasFee * 0.2; // Allow 20% difference
  const result = gasFeeDifference <= allowedDifference;

  console.log(
    result
      ? chalk.green(`Gas fee difference is within the allowed range: ${gasFeeDifference}.`)
      : chalk.red(`Gas fee difference exceeds the allowed range: ${gasFeeDifference}.`)
  );

  return result;
};

export const applyFilters = async (
  filterType,
  depositTxnHash,
  uniqueWithdrawalData
) => {
  let filteredData = uniqueWithdrawalData;

  if (filterType === "FILTER_1_AML_CHECK") {
    console.log(chalk.blue("Applying FILTER 1 (AML Check)..."));
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      return await FILTER_1_AML_CHECK(data.recipient);
    });

    console.log(chalk.cyan("Data after FILTER 1 (AML Check):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "FILTER_2_TIME_CHECK") {
    console.log(chalk.blue("Applying FILTER 2 (Time Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      const withdrawalData = await getTxnData(data.transactionHash);
      return await FILTER_2_TIME_CHECK(depositorData, withdrawalData);
    });

    console.log(chalk.cyan("Data after FILTER 2 (Time Check):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "ADV_FILTER_01_TXN_TYPE") {
    console.log(chalk.blue("Applying FILTER 3 (Transaction Type)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      const withdrawalData = await getTxnData(data.transactionHash);
      return await ADV_FILTER_01_TXN_TYPE(depositorData.type, withdrawalData.type);
    });

    console.log(chalk.cyan("Data after FILTER 3 (Transaction Type):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "ADV_FILTER_02_BLOCK_POSITION") {
    console.log(chalk.blue("Applying FILTER 4 (Block Position)..."));
    const depositorBlock = await getTransactionPositionInBlock(depositTxnHash);
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      const withdrawerBlock = await getTransactionPositionInBlock(data.transactionHash);
      return await ADV_FILTER_02_BLOCK_POSITION(depositorBlock, withdrawerBlock);
    });

    console.log(chalk.cyan("Data after FILTER 4 (Block Position):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "ADV_FILTER_03_BUILDER") {
    console.log(chalk.blue("Applying FILTER 5 (Builder Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      const withdrawalData = await getTxnData(data.transactionHash);
      return await ADV_FILTER_03_BUILDER(depositorData.miner, withdrawalData.miner);
    });

    console.log(chalk.cyan("Data after FILTER 5 (Builder Check):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "ADV_FILTER_04_GAS_FEES") {
    console.log(chalk.blue("Applying FILTER 6 (Gas Fees Check)..."));
    const depositorData = await getTxnData(depositTxnHash);
    filteredData = uniqueWithdrawalData.filter(async (data) => {
      const withdrawalData = await getTxnData(data.transactionHash);
      return await ADV_FILTER_04_GAS_FEES(depositorData.gasFee, withdrawalData.gasFee);
    });

    console.log(chalk.cyan("Data after FILTER 6 (Gas Fees Check):"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );

    return filteredData;
  }

  if (filterType === "basic" || filterType === "all") {
    console.log(chalk.blue("Applying Basic Filter..."));
    filteredData = await BasicFilter(depositTxnHash, filteredData);
    console.log(chalk.cyan("Filtered Data after Basic Filter:"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );
  }

  if (filterType === "advanced" || filterType === "all") {
    console.log(chalk.blue("Applying Advanced Filter..."));
    filteredData = await AdvancedFilter(depositTxnHash, filteredData);
    console.log(chalk.cyan("Filtered Data after Advanced Filter:"));
    filteredData.forEach((data, index) =>
      console.log(
        chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
      )
    );
  }

  console.log(chalk.green("Final Filtered Data:"));
  filteredData.forEach((data, index) =>
    console.log(
      chalk.whiteBright(`${index + 1}. Recipient: ${data.recipient}`)
    )
  );

  return filteredData;
};
