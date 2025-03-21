import fs from "fs/promises";
import bip38 from "bip38";
import bitcoin from "bitcoinjs-lib";
// import { encryptedKey, targetAddress } from "./const.js";

// TESTER
const encryptedKey = "6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg";
const targetAddress = "164MQi977u9GUteHr4EPH27VkkdxmfCvGW";

const passwordFilePath = process.argv[2];

if (!passwordFilePath) {
  console.error("Please provide the path to the passwords file as an argument.");
  process.exit(1);
}

const readPasswords = async (filePath) => {
  const data = await fs.readFile(filePath, "utf8");
  return data.split("\n").map(p => p.trim()).filter(Boolean);
};

const attemptDecryption = async (password) => {
  try {
    const privateKeyWif = bip38.decrypt(encryptedKey, password);
    const keyPair = bitcoin.ECPair.fromPrivateKey(privateKeyWif.privateKey);
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
    return address;
  } catch {
    return null;
  }
};

const main = async () => {
  const passwords = await readPasswords(passwordFilePath);
  const attempts = passwords.map(attemptDecryption);

  const results = Promise.all(attempts);
  
  for (let i = 0; i < results.length; i++) {
    if (results[i] === targetAddress) {
      console.log(`Password found: ${passwords[i]} | Address: ${results[i]}`);
      return;
    }
    console.log(`Attempt ${i + 1}: Password: ${passwords[i]}\nGenerated Address: ${results[i]}`);
    console.log();
  }

  console.log("No matching password found in the list.");
};

main().catch(err => console.error("An error occurred:", err));
