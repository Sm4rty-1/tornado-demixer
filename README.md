## Installation
Make sure you have Node.js and Yarn installed on your system.

### Install the necessary dependencies:
```yarn install```


## Usage
To run the tool, use the following command:
```yarn start```


## Steps:
You will be prompted to enter the deposit transaction hash.
Example: 0x26ea073bd6ce275fa781b71e104f980d4e259c076591d0924ddcb87cabd2ef6b

After entering the transaction hash, the tool will start analyzing the deposit and provide the demixed results.
Output will be displayed with the details about the transaction.

### Example Output:
```
✔ Enter the deposit transaction hash: 0x92a43c2e0f3186414f5d42756c3dd81335f16f42aab94b329d13ee44cc7c3f31
Starting Tornado Cash Deposit Analysis...

Deposit Wallet: 0x905315602Ed9a854e325F692FF82F58799BEaB57
Deposit Amount: 10 ETH
Deposit Time: 3/9/2025, 4:59:23 PM
Deposit Block Number: 22009020

The Deposit wallet is not present in AML List.
Fetching withdrawal transactions...

Suspicious Recipients (Unique): [
  '0x178312EBa226bAd13D76b38B1dba8D70f8e175cd',
  '0xDdFa650aEe0052Dd84de6266D51f6c44B2cda5C8'
]

Identified Suspicious Withdrawal Addresses was not present in AML list.
✨  Done in 17.73s.
```