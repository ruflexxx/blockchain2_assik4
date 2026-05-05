const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // 1. Deploy Governance Token
  console.log("Deploying GovernanceToken...");
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  
  const token = await GovernanceToken.deploy(
    deployer.address,
    deployer.address,
    deployer.address,
    deployer.address
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("GovernanceToken deployed to:", tokenAddress);

  // 2. Deploy Timelock Controller (2-day delay)
  console.log("Deploying TimelockController...");
  const minDelay = 172800; 
  const TimelockController = await ethers.getContractFactory("TimelockController");
  
  const timelock = await TimelockController.deploy(minDelay, [], [], deployer.address);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("TimelockController deployed to:", timelockAddress);

  console.log("Deploying MyGovernor...");
  const MyGovernor = await ethers.getContractFactory("MyGovernor");
  const governor = await MyGovernor.deploy(tokenAddress, timelockAddress);
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();
  console.log("MyGovernor deployed to:", governorAddress);

  console.log("Setting up governance roles...");
  const proposerRole = await timelock.PROPOSER_ROLE();
  const executorRole = await timelock.EXECUTOR_ROLE();
  const cancellerRole = await timelock.CANCELLER_ROLE();
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

  await timelock.grantRole(proposerRole, governorAddress);
  await timelock.grantRole(cancellerRole, governorAddress);
  await timelock.grantRole(executorRole, ethers.ZeroAddress);
  await timelock.revokeRole(adminRole, deployer.address);
  
  console.log("--------------------------------------------------");
  console.log("Deployment Summary:");
  console.log("Token:   ", tokenAddress);
  console.log("Timelock:", timelockAddress);
  console.log("Governor:", governorAddress);
  console.log("--------------------------------------------------");
  console.log("Governance system successfully deployed!");

  const addresses = {
    TOKEN_ADDRESS: tokenAddress,
    GOVERNOR_ADDRESS: governorAddress,
    TIMELOCK_ADDRESS: timelockAddress
  };

  fs.writeFileSync("contract-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\n Addresses saved to contract-addresses.json");
  
  const appJsPath = "app.js";
  if (fs.existsSync(appJsPath)) {
    let appJsContent = fs.readFileSync(appJsPath, "utf8");
    
    appJsContent = appJsContent.replace(
      /const GOVERNOR_ADDRESS = ".*";/,
      `const GOVERNOR_ADDRESS = "${governorAddress}";`
    );
    appJsContent = appJsContent.replace(
      /const TOKEN_ADDRESS = ".*";/,
      `const TOKEN_ADDRESS = "${tokenAddress}";`
    );
    
    fs.writeFileSync(appJsPath, appJsContent);
    console.log(" app.js updated automatically!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});