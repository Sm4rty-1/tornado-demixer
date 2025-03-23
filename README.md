# Tornado Cash Demixer

This tool is designed to analyze Tornado Cash transactions and identify potential withdrawal addresses linked to a given deposit transaction. It uses various filters to match patterns between deposit and withdrawal transactions.

## Features

- Fetch depositor details using a transaction hash.
- Identify potential withdrawal addresses based on deposit details.
- Apply multiple filters to narrow down suspicious withdrawal addresses.
- Perform AML checks on all withdrawal addresses.
- Interactive console for applying filters step-by-step.

## Installation

Ensure you have Node.js and Yarn installed on your system.

### Install Dependencies
```bash
yarn install
```

## Usage

Run the tool using the following command:
```bash
yarn start
```

### Steps

1. **Enter Deposit Transaction Hash**  
   You will be prompted to enter the deposit transaction hash.  
   Example: `0x26ea073bd6ce275fa781b71e104f980d4e259c076591d0924ddcb87cabd2ef6b`

2. **Analyze Deposit**  
   The tool fetches depositor details, including the depositor's address, deposit amount, and block number.

3. **Fetch Withdrawal Transactions**  
   The tool identifies potential withdrawal addresses and filters out excluded addresses.

4. **Apply Filters**  
   The tool applies various filters to match patterns between the depositor's transactions and each withdrawal address. Filters include:
   - **Time Check**: Checks if the withdrawal occurred within a suspicious time frame relative to the deposit.
   - **Transaction Type**: Matches transaction types between deposit and withdrawal.
   - **Block Position**: Compares the block positions of deposit and withdrawal transactions.
   - **Builder Check**: Matches the builders (miners) of the deposit and withdrawal transactions.
   - **Gas Fees Check**: Compares gas fees between deposit and withdrawal transactions.

5. **View Results**  
   After applying each filter, the tool displays the filtered list of potential withdrawal addresses.

### Example Output

```
✔ Enter the deposit transaction hash: 0xa62f69b29b866307afd4ea5b930df39c44009c842c4b61da0e80bbb7e33fa105
✔ Enter the number of deposit transactions with the same amount (default is 1): 1
✔ Enter the block number to search up to (default is latest): latest
Fetching the latest transaction for wallet: 0x43e04e72fb81d81157b89d7bd8c1a8F200AbA596
Depositor's Transactions: 0x424c37f1f99264e451097c957e5c563e2d44283670191d19b4b4a4c24a217a76
Fetching withdrawal transactions...

Unique Suspicious Withdrawal Transactions:
1. Recipient: 0xDa6196Ba587e959DCdB25162AF6e19FBf94e87eB, Hash: 0xea2b10b52334058cebf85b858b1c4e6c4c90bd4e9a25094edececdb3e97044e5
2. Recipient: 0x50365cB854435ae11B910F3c43a49f1fEb61A6ba, Hash: 0x86f368ed015d5daf2e193ca458ffe501ce79a8ca4a7453e684bc82d348ffae4f
3. Recipient: 0x76fDba04Ad70F07b0cF3cd3Df31262b063E9e6F0, Hash: 0x4b43c0bb4df8fca2e52aae48918ce4b7f6f14198f81dfeb50dd294ad1afc275e
4. Recipient: 0xc35b8540a136c54d6670BE25C4fE2f00719b7045, Hash: 0x187cb7a451b226fc7aefe02f113f7fc9eae33a316d07b034d3b82024ddf6642d
5. Recipient: 0xf126B8d11596321b615e690A15aF9F18A6E1d3e9, Hash: 0x52de5587cecca748b395ee5709238f1b6be89584a3fa723727f83e512813bfcf
6. Recipient: 0xD5cB660D82B472965C009a8c51D11fefCd80FDc9, Hash: 0x2ca574d43da022343b1e7228d37c79430df2a14ac81cdfeaf76f3b77a71b8a10
7. Recipient: 0xaA5bDa9c85a5446f08b613fC767c0443a1f367D1, Hash: 0xf6c4fc2adb2b19e3b1e3870a599f63862c6084c8bcb9dd8bf36ee7cd59d105e2
8. Recipient: 0x8b03f94cDe7f40815AD8C5d34135aa01eF58b84C, Hash: 0xe8f50892cfdfb8a334614b96117eaf712ff643ae1c01103a15866d7133d9e9b0
9. Recipient: 0x204F75F7232e1bCa54b264C822DC567e869CaB3D, Hash: 0x35135b5da8815e61d10a4f77b08552ac11278f232778d325e069075a91afed18
10. Recipient: 0xCB235e0A4Cf32e1f7277d12fB41D0C302121820d, Hash: 0xcfadc0f3b5cc042475f261516fedaef1997ade55c4ab9f94bf17a943dedfcda8
11. Recipient: 0xb7aCBd9EFD57e16b5EECC29576065D2434E93FaC, Hash: 0x00fda57824d9ee232dca329cffe1b2f65abd4f096593a11269ecd4664b4da76c
12. Recipient: 0xbDE4971DebABf1846170C32840E89A620020577D, Hash: 0xa8eebade7861957e8b6aeb7a9e5bfab4275f4a3125ae336a89b8e25d20367866

✔ Select a filter to apply: FILTER 3 (Block Position)
Applying ADV_FILTER_02_BLOCK_POSITION...
Applying FILTER 3 (Block Position)...

Filtered Data:
1. Recipient: 0xf126B8d11596321b615e690A15aF9F18A6E1d3e9
2. Recipient: 0xCB235e0A4Cf32e1f7277d12fB41D0C302121820d
3. Recipient: 0xb7aCBd9EFD57e16b5EECC29576065D2434E93FaC

✔ Press any key to return to the filter selection screen... 
✨  Done in 17.73s.
```

## Filters

### Time Check
Checks if the withdrawal occurred within a suspicious time frame relative to the deposit.  
Example: If the deposit occurred at 5 AM UTC, withdrawals between 3 AM and 7 AM UTC are flagged as suspicious.

### Transaction Type
Matches the transaction types of the deposit and withdrawal transactions.

### Block Position
Compares the block positions of the deposit and withdrawal transactions. A difference of more than 60 blocks is flagged as suspicious.

### Builder Check
Matches the builders (miners) of the deposit and withdrawal transactions.

### Gas Fees Check
Compares the gas fees of the deposit and withdrawal transactions. A difference of more than 20% is flagged as suspicious.


## Development

### File Structure

- **`src/main.js`**: Entry point of the application. Handles user input and orchestrates the analysis process.
- **`src/filter.js`**: Contains all the filters used to analyze transactions.
- **`src/utils.js`**: Utility functions for fetching transaction data and interacting with the blockchain.
- **`src/const.js`**: Contains constants such as excluded addresses and contract ABIs.

### How It Works

1. The tool starts by fetching depositor details using the provided transaction hash.
2. It identifies potential withdrawal addresses by analyzing transactions within the specified block range.
3. It applies filters to match patterns between the depositor's transactions and each withdrawal address.
4. The filtered list of suspicious withdrawal addresses is displayed after each filter.
