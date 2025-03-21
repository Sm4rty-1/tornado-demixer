const fs = require("fs");
const bip38 = require("bip38"); // Import the bip38 module directly
const bitcoin = require("bitcoinjs-lib"); // Import bitcoinjs-lib for key manipulation

// TESTER
const encryptedKey = "6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg";
const targetAddress = "164MQi977u9GUteHr4EPH27VkkdxmfCvGW";

const passwordFilePath = process.argv[2];

if (!passwordFilePath) {
  console.error(
    "Please provide the path to the passwords file as an argument."
  );
  process.exit(1);
}

fs.readFile(passwordFilePath, "utf8", (err, data) => {
  if (err) {
    console.error("Error reading passwords file:", err);
    return;
  }

  const passwords = data
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  let found = false;
  let triedCount = 0; // Counter for tried passwords

  for (const password of passwords) {
    triedCount++; // Increment the counter for each password tried
    try {
      const privateKeyWif = bip38.decrypt(encryptedKey, password);
      const privateKeyBuffer = bitcoin.ECPair.fromPrivateKey(
        privateKeyWif.privateKey
      ).toWIF();
      const { publicKey } = bitcoin.ECPair.fromPrivateKey(
        privateKeyWif.privateKey
      );
      const { address } = bitcoin.payments.p2pkh({ pubkey: publicKey });
      console.log(
        `Attempt ${triedCount}: Password: ${password} | Generated Address: ${address}`
      );

      if (address === targetAddress) {
        console.log("The generated address matches the target address!");
        found = true;
        break; // Exit loop if found
      } else {
        console.log("The generated address does not match the target address.");
        console.log();
      }
    } catch (error) {
      console.error(
        `Decryption failed for password "${password}": ${error.message}`
      );
    }
  }

  console.log(`Tried ${triedCount} passwords.`); // Log the number of tried passwords

  if (!found) {
    console.log("No matching password found in the list.");
  }
});
