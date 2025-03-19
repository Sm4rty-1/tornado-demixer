
const recipients = [];


const extractRecipientFromTransaction = async (hash) => {
  try {
    const iface = new ethers.utils.Interface(contractABI);
    const transaction = await provider.getTransaction(hash);
    if (!transaction) {
      console.warn(chalk.yellow(`Transaction not found: ${hash}`));
      return null;
    }
    const decodedData = iface.parseTransaction({ data: transaction.data });
    // console.log(decodedData.args[4]);
    return decodedData.args[4];
  } catch (error) {
    // console.error(chalk.red(`Error decoding transaction ${hash}:`), error);
    return null;
  }
};

async function fetchWithdrawalRecipients(fromBlock, tornadoCashAddress) {
    const toBlock = await provider.getBlockNumber();
    const recipients = new Set(); // Use a Set to automatically remove duplicates
  
    const logs = await provider.getLogs({
      address: tornadoCashAddress,
      fromBlock: ethers.utils.hexValue(fromBlock),
      toBlock: ethers.utils.hexValue(toBlock),
      topics: [
        "0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931",
      ],
    });
  
    for (const log of logs) {
      const recipient = await extractRecipientFromTransaction(log.transactionHash);
      if (recipient) {
        // console.log(chalk.green(`Recipient found for transaction ${log.transactionHash}: ${recipient}`));
        recipients.add(recipient); // Add recipient to the Set
      } else {
        // console.log(chalk.yellow(`No recipient found for transaction ${log.transactionHash}`));
      }
    }
    console.log();
    console.log(chalk.cyan(`Suspicious Recipients (Unique):`), Array.from(recipients));
    return Array.from(recipients); // Convert Set back to Array for return
  }
  

const retrieveWithdrawalTransactions = async (fromBlock, depositAmount) => {
  console.log(chalk.blue(`Fetching withdrawal transactions...`));

  if (depositAmount == 1e17) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_01ETH);
  } else if (depositAmount == 1e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_1ETH);
  } else if (depositAmount == 10e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_10ETH);
  } else if (depositAmount == 100e18) {
    return fetchWithdrawalRecipients(fromBlock, TORN_ADDRESS_100ETH);
  } else {
    console.warn(chalk.yellow(`Unsupported deposit amount: ${depositAmount}`));
    return [];
  }
};

const analyzeTornadoCashDeposit = async (depositHash) => {
  console.log(chalk.green.bold("Starting Tornado Cash Deposit Analysis...\n"));

  const depositDetails = await retrieveDepositDetails(depositHash);

  if (!depositDetails) {
    console.error(chalk.red("Failed to retrieve deposit details."));
    return;
  }

  console.log(chalk.cyan("Deposit Wallet:"), depositDetails.from);
  console.log(
    chalk.cyan("Deposit Amount:"),
    (depositDetails.value / 1e18).toString(),
    "ETH"
  );
  console.log(chalk.cyan("Deposit Time:"), new Date(depositDetails.blockTimestamp * 1000).toLocaleString());
  console.log(chalk.cyan("Deposit Block Number:"), depositDetails.blockNumber);

  const isDepositerClean = await checkAddressAgainstAML(depositDetails.from);
  console.log();
  if (isDepositerClean === true) {
    console.log(chalk.green("The Deposit wallet is not present in AML List."));
  } else if (isDepositerClean === false) {
    console.log(chalk.red("The Deposit wallet is present in AML List."));
  } else {
    console.warn(
      chalk.yellow("Could not determine AML status for the deposit wallet.")
    );
  }

  const withdrawalAddresses = await retrieveWithdrawalTransactions(
    depositDetails.blockNumber,
    depositDetails.value
  );

  if (withdrawalAddresses.length === 0) {
    console.warn(
      chalk.yellow("No withdrawal transactions found for this deposit.")
    );
    return;
  }

  const suspiciousAddresses = await identifyDemixedWithdrawals(
    withdrawalAddresses
  );

  if (suspiciousAddresses.length > 0) {
    console.warn(
      chalk.red.bold(
        "\nIdentified Suspicious Withdrawal Addresses (Present in AML List):"
      )
    );
    suspiciousAddresses.forEach((address) => console.log(chalk.red(address)));
    return suspiciousAddresses;
  } else {
    console.log(
      chalk.green.bold("\nIdentified Suspicious Withdrawal Addresses was not present in AML list.")
    );
    return [];
  }
};

const main = async () => {
  const depositHash = await askForDepositHash();
  if (depositHash) {
    await analyzeTornadoCashDeposit(depositHash);
  }
};

main();
