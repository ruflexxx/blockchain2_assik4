const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("DAO Treasury & Box Control", function () {
  async function deployFixture() {
    const [owner, voter, receiver] = await ethers.getSigners();

    // 1. Deploy Token
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy(owner.address, owner.address, owner.address, owner.address);
    await token.waitForDeployment();

    // 2. Deploy Timelock (2-day delay)
    const minDelay = 2 * 24 * 60 * 60; // 172800 seconds
    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock = await TimelockController.deploy(minDelay, [], [], owner.address);
    await timelock.waitForDeployment();

    // 3. Deploy Governor
    const MyGovernor = await ethers.getContractFactory("MyGovernor");
    const governor = await MyGovernor.deploy(await token.getAddress(), await timelock.getAddress());
    await governor.waitForDeployment();

    // 4. Deploy Treasury
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy();
    await treasury.waitForDeployment();
    await treasury.transferOwnership(await timelock.getAddress());

    // 5. Deploy Box
    const Box = await ethers.getContractFactory("Box");
    const box = await Box.deploy();
    await box.waitForDeployment();
    await box.transferOwnership(await timelock.getAddress());

    // 6. Setup Timelock roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, ethers.ZeroAddress);
    await timelock.revokeRole(adminRole, owner.address);

    // 7. Setup Voting Power
    await token.transfer(voter.address, ethers.parseEther("5000000")); // 5% of total supply
    await token.connect(voter).delegate(voter.address);

    // 8. Fund Treasury with ETH and ERC20
    const ethAmount = ethers.parseEther("10");
    await owner.sendTransaction({ to: await treasury.getAddress(), value: ethAmount });
    
    const tokenAmount = ethers.parseEther("1000");
    await token.transfer(await treasury.getAddress(), tokenAmount);

    return { token, timelock, governor, treasury, box, owner, voter, receiver };
  }

  it("Should successfully execute Box.store(42) via governance", async function () {
    const { governor, box, voter } = await loadFixture(deployFixture);
    
    const newValue = 42;
    const description = "Store 42 in Box";
    const calldata = box.interface.encodeFunctionData("store", [newValue]);
    
    // ========== STEP 1: PROPOSE ==========
    console.log("\n========== STEP 1: PROPOSE ==========");
    const proposeTx = await governor.connect(voter).propose(
      [await box.getAddress()], 
      [0], 
      [calldata], 
      description
    );
    const receipt = await proposeTx.wait();
    const proposalId = receipt.logs[0].args.proposalId;
    console.log(" Proposal created!");
    console.log(" Proposal ID:", proposalId);
    console.log(" Proposer:", voter.address);
    console.log(" Target contract:", await box.getAddress());
    console.log(" Description:", description);
    console.log(" New value to store:", newValue);

    // ========== STEP 2: VOTE ==========
    console.log("\n========== STEP 2: VOTE ==========");
    await mine(Number(await governor.votingDelay()) + 1);
    console.log(" Voting delay passed (1 day)");
    
    await governor.connect(voter).castVote(proposalId, 1); // 1 = FOR
    console.log(" Vote cast!");
    console.log(" Voter:", voter.address);
    console.log(" Vote: FOR");
    
    await mine(Number(await governor.votingPeriod()) + 1);
    console.log(" Voting period ended (1 week)");

    // ========== STEP 3: QUEUE ==========
    console.log("\n========== STEP 3: QUEUE ==========");
    const descriptionHash = ethers.id(description);
    await governor.queue([await box.getAddress()], [0], [calldata], descriptionHash);
    console.log(" Proposal queued in Timelock!");
    console.log(" Timelock delay: 2 days (172800 seconds)");

    // ========== STEP 4: EXECUTE ==========
    console.log("\n========== STEP 4: EXECUTE ==========");
    await time.increase(2 * 24 * 60 * 60 + 1);
    console.log(" Timelock delay passed (2 days)");
    
    await governor.execute([await box.getAddress()], [0], [calldata], descriptionHash);
    console.log(" Proposal executed!");
    console.log(" Executed by Timelock");

    // ========== STEP 5: VERIFY ==========
    console.log("\n========== STEP 5: VERIFY ==========");
    const currentValue = await box.retrieve();
    expect(currentValue).to.equal(newValue);
    console.log(" Box.retrieve() =", currentValue.toString());
    console.log(" Success! Governance changed Box value to 42\n");
  });

  it("Should successfully withdraw ETH from Treasury via governance", async function () {
    const { governor, treasury, voter, receiver } = await loadFixture(deployFixture);
    
    const withdrawAmount = ethers.parseEther("1");
    const description = "Withdraw 1 ETH from Treasury";
    const calldata = treasury.interface.encodeFunctionData("withdraw", [receiver.address, withdrawAmount]);
    
    const beforeBalance = await ethers.provider.getBalance(receiver.address);

    console.log("\n========== ETH WITHDRAWAL TEST ==========");
    console.log(" Creating proposal to withdraw 1 ETH from Treasury...");
    
    // Propose
    await governor.connect(voter).propose([await treasury.getAddress()], [0], [calldata], description);
    const proposalId = await governor.hashProposal([await treasury.getAddress()], [0], [calldata], ethers.id(description));

    await mine(Number(await governor.votingDelay()) + 1);
    await governor.connect(voter).castVote(proposalId, 1);
    console.log(" Vote cast FOR");
    await mine(Number(await governor.votingPeriod()) + 1);

    await governor.queue([await treasury.getAddress()], [0], [calldata], ethers.id(description));
    console.log(" Proposal queued");
    await time.increase(2 * 24 * 60 * 60 + 1);
    await governor.execute([await treasury.getAddress()], [0], [calldata], ethers.id(description));
    console.log(" Proposal executed");

    const afterBalance = await ethers.provider.getBalance(receiver.address);
    expect(afterBalance - beforeBalance).to.equal(withdrawAmount);
    console.log(" ETH withdrawn successfully! Amount:", ethers.formatEther(withdrawAmount), "ETH\n");
  });

  it("Should successfully withdraw ERC20 from Treasury via governance", async function () {
    const { token, governor, treasury, voter, receiver } = await loadFixture(deployFixture);
    
    const withdrawAmount = ethers.parseEther("100");
    const description = "Withdraw 100 GOV from Treasury";
    const calldata = treasury.interface.encodeFunctionData("withdrawERC20", [await token.getAddress(), receiver.address, withdrawAmount]);
    
    console.log("\n========== ERC20 WITHDRAWAL TEST ==========");
    console.log(" Creating proposal to withdraw 100 GOV from Treasury...");
    
    // Propose
    await governor.connect(voter).propose([await treasury.getAddress()], [0], [calldata], description);
    const proposalId = await governor.hashProposal([await treasury.getAddress()], [0], [calldata], ethers.id(description));

    await mine(Number(await governor.votingDelay()) + 1);
    await governor.connect(voter).castVote(proposalId, 1);
    console.log(" Vote cast FOR");
    await mine(Number(await governor.votingPeriod()) + 1);

    await governor.queue([await treasury.getAddress()], [0], [calldata], ethers.id(description));
    console.log(" Proposal queued");
    await time.increase(2 * 24 * 60 * 60 + 1);
    await governor.execute([await treasury.getAddress()], [0], [calldata], ethers.id(description));
    console.log(" Proposal executed");

    expect(await token.balanceOf(receiver.address)).to.equal(withdrawAmount);
    console.log(" ERC20 withdrawn successfully! Amount:", ethers.formatEther(withdrawAmount), "GOV\n");
  });
});