const fs = require('fs');
const bip39 = require('bip39');
const bitcoin = require('bitcoinjs-lib');

// Function to derive the private key from a mnemonic
function getPrivateKey(mnemonic) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bitcoin.bip32.fromSeed(seed);
    const child = root.derivePath("m/44'/0'/0'/0/0"); // Standard derivation path for BTC
    return child.toWIF(); // Returns the private key in WIF format
}

// Function to check if the derived address matches the target address
function checkAddress(mnemonic, targetAddress) {
    const privateKey = getPrivateKey(mnemonic);
    const keyPair = bitcoin.ECPair.fromWIF(privateKey);
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
    return address === targetAddress;
}

// Main function to read mnemonics from a file and find the correct one
async function findSeedPhrase(targetAddress, filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    const mnemonics = data.split('\n').map(line => line.trim()).filter(Boolean);

    for (const mnemonic of mnemonics) {
        if (checkAddress(mnemonic, targetAddress)) {
            console.log(`Found matching seed phrase: ${mnemonic}`);
            console.log(`Private Key: ${getPrivateKey(mnemonic)}`);
            return;
        }
    }
    console.log('No matching seed phrase found.');
}

// Replace with your actual Bitcoin address and markdown file path
const btcAddress = '1K4ezpLybootYF23TM4a8Y4NyP7auysnRo';
const mdFilePath = './file.md'; // Update this path

findSeedPhrase(btcAddress, mdFilePath);
