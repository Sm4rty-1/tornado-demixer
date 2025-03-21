import axios from "axios";
import { ethers } from "ethers";
import inquirer from "inquirer";
import chalk from "chalk";
import { providerUrl } from "./const.js";

const provider = new ethers.providers.JsonRpcProvider(providerUrl);

/*  FILTERS
1. check against AML
2. compare for deposit txn gas price and withdrawl txns gas price.
3. 


For Multi Asset?
1. if multiple deposits hashes are given, then check for if the same amount of withdrawl is made by the same ens. 

ask for upto blockNumber for limiting or if none passed in then just use block.timestamp. 


BASIC FILTER:
Filter Logic 1 (AML Check)
Filter Logic 2 (Time checking; -2, +2 hours)

Get Further transfer for each withdrawl address after Final list of wallets. 
Get before wallet of user that deposited into TC. 

Then Advanced Filter: 
 - Get txns of deposit wallet other than tc, and txns of withdrawl addresses other than withdrawl: 
 - Compare Deposit wallet past txns data with withdrawl wallet data: 
    - Txns Position in Block
    - RPC / Builder Used?
    - Time when wallet is active
    - Txn Type
    - Gas fees
        - Legacy (check gas % paid respective to that block base gas)
        - EIP1559 (check max Gas and priority fee paid)



*/

// check against AML:
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

// export const FILTER_2_