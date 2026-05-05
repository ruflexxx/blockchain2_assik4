const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDRESSES_PATH = path.join(__dirname, "..", "contract-addresses.json");

function readTokenAddress() {
    try {
        const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
        return addresses.TOKEN_ADDRESS;
    } catch (error) {
        throw new Error("contract-addresses.json not found. Run the deploy script first.");
    }
}

function getAmount() {
    const rawAmount = process.env.AMOUNT_GTK || "10000";
    return ethers.parseEther(rawAmount);
}

async function findFundedSigner(token, signers, amount) {
    for (const signer of signers) {
        const balance = await token.balanceOf(signer.address);
        if (balance >= amount) {
            return signer;
        }
    }

    return null;
}

async function main() {
    const signers = await ethers.getSigners();
    const defaultRecipient = signers[signers.length - 1]?.address ?? signers[0]?.address;
    const recipient = process.env.RECIPIENT_ADDRESS || defaultRecipient;

    if (!recipient || !ethers.isAddress(recipient)) {
        throw new Error("Set RECIPIENT_ADDRESS to a valid EVM address.");
    }

    const tokenAddress = readTokenAddress();
    const token = await ethers.getContractAt("GovernanceToken", tokenAddress);
    const amount = getAmount();
    const sender = await findFundedSigner(token, signers, amount);

    if (!sender) {
        throw new Error("No available signer has enough GTK to complete the transfer.");
    }

    const tx = await token.connect(sender).transfer(recipient, amount);
    await tx.wait();

    console.log(`Token address: ${tokenAddress}`);
    console.log(`Sender: ${sender.address}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Sent ${ethers.formatEther(amount)} GTK`);
    console.log(`Transaction: ${tx.hash}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
