import axios from "axios";
import { ethers } from "ethers";

const providerUrl =
  "https://eth-mainnet.g.alchemy.com/v2/WMk4zoR-oKpUU5LYitsb1weZAASeAiti";
const provider = new ethers.providers.JsonRpcProvider(providerUrl);

const TORNADO_ROUTER_ADDRESS = "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b";
const WITHDRAWAL_TOPIC =
  "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931";

// Tornado Cash Ethereum mainnet addresses.
export const TORN_ADDRESS_100ETH = "0xA160cdAB225685dA1d56aa342Ad8841c3b53f291";
export const TORN_ADDRESS_10ETH = "0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF";
export const TORN_ADDRESS_1ETH = "0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936";
export const TORN_ADDRESS_01ETH = "0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc";

const contractABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_tornado",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "_proof",
        type: "bytes",
      },
      {
        internalType: "bytes32",
        name: "_root",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_nullifierHash",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "_recipient",
        type: "address",
      },
      {
        internalType: "address",
        name: "_relayer",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_fee",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_refund",
        type: "uint256",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function checkAML(cryptoAddress) {
  try {
    const url = `https://monetory.io/api/v2/crypto_address_check?crypto_address=${cryptoAddress}`;
    const response = await axios.get(url, {
      headers: { "user-agent": "bob" },
    });
    if (response.data) {
      if (response.data.is_ok === true) {
        return true;
      } else if (response.data.is_ok === false) {
        return false;
      }
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

async function checkAMLWithdraw(withdrawals) {
  const demixedWithdrawals = [];

  for (const withdrawal of withdrawals) {
    // AML Check
    const isOk = await checkAML(withdrawal.to); 
    // Check the recipient address
    if (!isOk) {
      demixedWithdrawals.push(withdrawal);
    }
  }

  return demixedWithdrawals;
}

async function fetchDepositDetails(depositTxHash) {
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
    console.error("Error fetching deposit details:", error);
    return null;
  }
}

async function getWithdrawalData(fromBlock, TORNADO_CASH_ROUTER_ADDRESS) {
  const toBlock = await provider.getBlockNumber();
  const receipients = [];

  const logs = await provider.getLogs({
    address: TORNADO_CASH_ROUTER_ADDRESS,
    fromBlock: ethers.utils.hexValue(fromBlock),
    toBlock: ethers.utils.hexValue(toBlock),
    topics: [
      "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931",
    ],
  });

  logs.forEach(async (log) => {
    const receipient = await getRecipientFromHash(log.transactionHash);
    receipients.push(receipient);
    });
    
  return recipients;
}

async function getRecipientFromHash(hash) {
  try {
    const iface = new ethers.utils.Interface(contractABI);
    const transaction = await provider.getTransaction(hash);
    const decodedData = iface.parseTransaction({ data: transaction.data });
    const recipient = decodedData.args[4];
    console.log("Suspicious Recipient:", recipient);
    return recipient;
  } catch (error) {
    return null; // Return null or a default value if an error occurs
  }
}


async function fetchWithdrawalTransactions(fromBlock, depositAmount) {
  try {
    if (depositAmount == 1e17) {
      const receipients = getWithdrawalData(fromBlock, TORN_ADDRESS_01ETH);
      return receipients;
    }
    if (depositAmount == 1e18) {
      const receipients = getWithdrawalData(fromBlock, TORN_ADDRESS_1ETH);
      return receipients;
    }
    if (depositAmount == 10e18) {
      const receipients = getWithdrawalData(fromBlock, TORN_ADDRESS_10ETH);
      return receipients;
    }
    if (depositAmount == 100e18) {
      const receipients = getWithdrawalData(fromBlock, TORN_ADDRESS_100ETH);
      return receipients;
    }
  } catch (error) {}
}



async function main(depositHash) {
  const depositDetails = await fetchDepositDetails(
    depositHash
  );
  console.log("Deposit Wallet: ", depositDetails.from);
  console.log(
    "Deposit Amount: ",
    (depositDetails.value / 1e18).toString(),
    "ETH"
  );
  console.log("Deposit Time: ", depositDetails.blockTimestamp);
  console.log("Deposit Block Number: ", depositDetails.blockNumber);

  const depositer = depositDetails.from;
  try {
    // Check AML
    const isOk = await checkAML(depositer);
    if (isOk == true) {
      console.log("The Deposit wallet is not present in AML List.");
    } else if (isOk == false) {
      console.log("The Deposit wallet is present in AML List.");
    }

    // check withdrawl txns:
    const withdrawData = await fetchWithdrawalTransactions(
      depositDetails.blockNumber,
      depositDetails.value
    );
    console.log(withdrawData);

    // check AML Withdrawl address..
    const demixedWithdrawals = await checkAMLWithdraw(withdrawData);
    console.log(demixedWithdrawals);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

const hash = '0x377ff818281424023c65fb9a792024d6a6103e69976af263be3b4513b389ee17';
main();
