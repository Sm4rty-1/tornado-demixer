

const analyzeTornadoCashDeposit = async (depositHash) => {
  console.log(chalk.green.bold("Starting Tornado Cash Deposit Analysis...\n"));

  const depositDetails = await getTxnData(depositHash);

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
