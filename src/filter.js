import axios from "axios";
import chalk from "chalk";
import {getTransactionPositionInBlock, getTxnData} from "./utils.js";


export const BasicFilter = async (depositTxnHash, withdrawTxnHash) => {
  const depositorData = await getTxnData(depositTxnHash);
  const withdrawData = await getTxnData(withdrawTxnHash);

  FILTER_1_AML_CHECK(withdrawData.from);
  FILTER_2_TIME_CHECK(depositorData,withdrawData);
}


// for each filter return either true or false... 
export const FILTER_1_AML_CHECK = async (address) => {
  try {
    const url = `https://monetory.io/api/v2/crypto_address_check?crypto_address=${address}`;
    const response = await axios.get(url, {
      headers: { "user-agent": "bob" },
    });
    if (response.data) {
      return response.data.is_ok;
    }
    return null;
  } catch (error) {
    console.error(
      chalk.red(`AML Check Failed for ${cryptoAddress}:`),
      error.message
    );
    return null;
  }
};

export const FILTER_2_TIME_CHECK = async (depositData, withdrawData) => {
  const depositTime = depositData.blockTimestamp;
  const withdrawTime = withdrawData.blockTimestamp;

  const timeDifference = Math.abs(withdrawTime - depositTime); // Time difference in seconds
  const allowedTimeRange = 2 * 60 * 60; // 2 hours in seconds

  return timeDifference <= allowedTimeRange;
};



export const AdvancedFilter = async (depositTxnHash, withdrawTxnHash) => {
  const depositorData = await getTxnData(depositTxnHash);
  const withdrawData = await getTxnData(withdrawTxnHash);
  const DepositerBlock = getTransactionPositionInBlock(depositTxnHash);
  const WithdrawerBlock = getTransactionPositionInBlock(withdrawTxnHash);

  const txnTypeCheck = await ADV_FILTER_01_TXN_TYPE(depositorData.type, withdrawData.type);
  const blockPositionCheck = await ADV_FILTER_02_BLOCK_POSITION(DepositerBlock, WithdrawerBlock);
  const builderCheck = await ADV_FILTER_03_BUILDER(depositorData.miner, withdrawData.miner);
  const gasFeesCheck = await ADV_FILTER_04_GAS_FEES(depositorData.gasFee, withdrawData.gasFee);

  return txnTypeCheck && blockPositionCheck && builderCheck && gasFeesCheck;
};

export const ADV_FILTER_01_TXN_TYPE = async (depositorType, withdrawerType) => {
  return depositorType === withdrawerType;
};

export const ADV_FILTER_02_BLOCK_POSITION = async (depositorBlock, withdrawerBlock) => {
  const positionDifference = Math.abs(depositorBlock - withdrawerBlock);
  return positionDifference <= 60;
};

export const ADV_FILTER_03_BUILDER = async (depositorBuilder, withdrawerBuilder) => {
  return depositorBuilder === withdrawerBuilder;
};

export const ADV_FILTER_04_GAS_FEES = async (depositorGasFee, withdrawerGasFee) => {
  const gasFeeDifference = Math.abs(depositorGasFee - withdrawerGasFee);
  const allowedDifference = depositorGasFee * 0.2; // Allow 10% difference
  return gasFeeDifference <= allowedDifference;
};