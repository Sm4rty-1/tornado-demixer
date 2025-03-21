const fs = require("fs");
const bip38 = require("bip38");
const bitcoin = require("bitcoinjs-lib");

const encryptedKey = "6PfTK9JsSkUkA4hjs9zjrsKg3xYEFbfbNFE4SByhkGTMbGUEJPE7uxV4Hm";
const targetAddress = "1C2Kfv4Y2isJkbtGs52YXDjTr74PuXkko4";

const md5Hash = "428dad6c6851f481375f7309a40fc874";


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
  let triedCount = 0;

  for (const password of passwords) {
    triedCount++;
    try {
      const { address } = bitcoin.payments.p2pkh({
        pubkey: bitcoin.ECPair.fromPrivateKey(
          bip38.decrypt(encryptedKey, password).privateKey
        ).publicKey,
      });

      console.log(`Attempt ${triedCount}: Password: ${password} Generated Address: ${address}`);
      if (address === targetAddress) {
        console.log("The generated address matches the target address!");
        console.log(`Password: ${password} | Generated Address: ${address}`);
        found = true;
        break;
      }
    } catch (error) {
      console.error(
        `Decryption failed for password "${password}": Attempt ${triedCount}`
      );
    }
  }

  console.log(`Tried ${triedCount} passwords.`); // Log the number of tried passwords

  if (!found) {
    console.log("No matching password found in the list.");
  }
});
