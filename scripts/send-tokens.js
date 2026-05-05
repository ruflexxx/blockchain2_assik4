const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await ethers.getSigners();
    
    let tokenAddress;
    try {
        const addresses = JSON.parse(fs.readFileSync("contract-addresses.json", "utf8"));
        tokenAddress = addresses.TOKEN_ADDRESS;
        console.log(" Token address loaded from contract-addresses.json:", tokenAddress);
    } catch (err) {
        console.error(" contract-addresses.json not found. Run deploy first!");
        process.exit(1);
    }
    
    const myAddress = "0x4a2Bc3f90e4fF4F20bCb192Bb991494b0A6E24C6";
    
    const token = await ethers.getContractAt("GovernanceToken", tokenAddress);
    
    const amount = ethers.parseEther("10000");
    const tx = await token.transfer(myAddress, amount);
    await tx.wait();
    
    console.log(` Sent ${ethers.formatEther(amount)} GTK to ${myAddress}`);
    console.log(`Transaction: ${tx.hash}`);
}

main().catch(console.error);