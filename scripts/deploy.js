const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const APP_JS_PATH = path.join(__dirname, "..", "app.js");
const ADDRESSES_PATH = path.join(__dirname, "..", "contract-addresses.json");
const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

function getEnvNumber(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return parsedValue;
}

function getEnvAddress(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  if (!ethers.isAddress(rawValue)) {
    throw new Error(`${name} must be a valid EVM address`);
  }

  return rawValue;
}

async function waitForTx(txPromise, successMessage) {
  const tx = await txPromise;
  await tx.wait();

  if (successMessage) {
    console.log(successMessage);
  }
}

async function deployContract(contractName, constructorArgs = []) {
  console.log(`Deploying ${contractName}...`);
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...constructorArgs);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`${contractName} deployed to: ${contractAddress}`);

  return contract;
}

function updateFrontendAddresses(governorAddress, tokenAddress) {
  if (!fs.existsSync(APP_JS_PATH)) {
    return;
  }

  let appJsContent = fs.readFileSync(APP_JS_PATH, "utf8");
  appJsContent = appJsContent.replace(
    /const GOVERNOR_ADDRESS = ".*";/,
    `const GOVERNOR_ADDRESS = "${governorAddress}";`
  );
  appJsContent = appJsContent.replace(
    /const TOKEN_ADDRESS = ".*";/,
    `const TOKEN_ADDRESS = "${tokenAddress}";`
  );

  fs.writeFileSync(APP_JS_PATH, appJsContent);
}

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  if (!deployer) {
    throw new Error("No deployer signer available.");
  }

  const latestBlock = await ethers.provider.getBlock("latest");
  const chain = await ethers.provider.getNetwork();
  const communityFallback = signers[1]?.address ?? deployer.address;
  const liquidityFallback = signers[2]?.address ?? deployer.address;
  const teamBeneficiaryFallback = signers[3]?.address ?? deployer.address;

  const teamBeneficiary = getEnvAddress("TEAM_BENEFICIARY", teamBeneficiaryFallback);
  const communityRecipient = getEnvAddress("COMMUNITY_ADDRESS", communityFallback);
  const liquidityRecipient = getEnvAddress("LIQUIDITY_ADDRESS", liquidityFallback);
  const initialFeeBps = getEnvNumber("INITIAL_FEE_BPS", 500);
  const minDelay = getEnvNumber("TIMELOCK_DELAY", 2 * 24 * 60 * 60);
  const vestingDuration = getEnvNumber("VESTING_DURATION", YEAR_IN_SECONDS);
  const vestingStart = getEnvNumber("VESTING_START", Number(latestBlock.timestamp) + 60);

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Network:", network.name, "| Chain ID:", chain.chainId.toString());

  const treasury = await deployContract("Treasury");
  const box = await deployContract("Box");
  const mockConfig = await deployContract("MockConfig", [initialFeeBps]);

  console.log("Deploying TimelockController...");
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(minDelay, [], [], deployer.address);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("TimelockController deployed to:", timelockAddress);

  const token = await deployContract("GovernanceToken", [
    deployer.address,
    await treasury.getAddress(),
    communityRecipient,
    liquidityRecipient,
  ]);
  const tokenAddress = await token.getAddress();

  const vesting = await deployContract("TokenVesting", [
    tokenAddress,
    teamBeneficiary,
    vestingStart,
    vestingDuration,
  ]);

  const governor = await deployContract("MyGovernor", [tokenAddress, timelockAddress]);
  const governorAddress = await governor.getAddress();

  const teamAllocation = ((await token.totalSupply()) * 40n) / 100n;

  await waitForTx(
    token.transfer(await vesting.getAddress(), teamAllocation),
    "Moved the full team allocation into the vesting contract."
  );
  await waitForTx(
    treasury.transferOwnership(timelockAddress),
    "Treasury ownership transferred to TimelockController."
  );
  await waitForTx(
    box.transferOwnership(timelockAddress),
    "Box ownership transferred to TimelockController."
  );
  await waitForTx(
    mockConfig.transferOwnership(timelockAddress),
    "MockConfig ownership transferred to TimelockController."
  );

  console.log("Setting up governance roles...");
  const [proposerRole, executorRole, cancellerRole, adminRole] = await Promise.all([
    timelock.PROPOSER_ROLE(),
    timelock.EXECUTOR_ROLE(),
    timelock.CANCELLER_ROLE(),
    timelock.DEFAULT_ADMIN_ROLE(),
  ]);

  await waitForTx(
    timelock.grantRole(proposerRole, governorAddress),
    "Granted proposer role to Governor."
  );
  await waitForTx(
    timelock.grantRole(cancellerRole, governorAddress),
    "Granted canceller role to Governor."
  );
  await waitForTx(
    timelock.grantRole(executorRole, ethers.ZeroAddress),
    "Granted executor role to everyone."
  );
  await waitForTx(
    timelock.revokeRole(adminRole, deployer.address),
    "Revoked deployer admin role from TimelockController."
  );

  const addresses = {
    network: network.name,
    chainId: Number(chain.chainId),
    deployedAt: new Date().toISOString(),
    TOKEN_ADDRESS: tokenAddress,
    GOVERNOR_ADDRESS: governorAddress,
    TIMELOCK_ADDRESS: timelockAddress,
    TREASURY_ADDRESS: await treasury.getAddress(),
    BOX_ADDRESS: await box.getAddress(),
    MOCK_CONFIG_ADDRESS: await mockConfig.getAddress(),
    VESTING_ADDRESS: await vesting.getAddress(),
    config: {
      minDelay,
      initialFeeBps,
      vestingStart,
      vestingDuration,
      teamBeneficiary,
      communityRecipient,
      liquidityRecipient,
    },
  };

  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  updateFrontendAddresses(governorAddress, tokenAddress);

  console.log("--------------------------------------------------");
  console.log("Deployment Summary:");
  console.log("Token:       ", tokenAddress);
  console.log("Governor:    ", governorAddress);
  console.log("Timelock:    ", timelockAddress);
  console.log("Treasury:    ", await treasury.getAddress());
  console.log("Vesting:     ", await vesting.getAddress());
  console.log("Box:         ", await box.getAddress());
  console.log("MockConfig:  ", await mockConfig.getAddress());
  console.log("--------------------------------------------------");
  console.log("Saved deployment metadata to contract-addresses.json");
  console.log("Updated frontend contract addresses in app.js");
  console.log("Governance system successfully deployed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
