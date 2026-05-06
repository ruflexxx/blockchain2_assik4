import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.getOrCreate();
const { loadFixture, mine, time } = networkHelpers;

describe("DAO Governance", function () {
  async function deployGovernorFixture() {
    const [owner, proposer, voter1, voter2, receiver, other] = await ethers.getSigners();

    // 1. Deploy Token
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy(owner.address, owner.address, owner.address, owner.address);

    // 2. Deploy Timelock (2-day delay)
    const TimelockController = await ethers.getContractFactory("TimelockController");
    const minDelay = 2 * 24 * 60 * 60; // 2 days
    const timelock = await TimelockController.deploy(minDelay, [], [], owner.address);

    // 3. Deploy Governor
    const MyGovernor = await ethers.getContractFactory("MyGovernor");
    const governor = await MyGovernor.deploy(await token.getAddress(), await timelock.getAddress());

    // 4. Deploy MockConfig
    const MockConfig = await ethers.getContractFactory("MockConfig");
    const mockConfig = await MockConfig.deploy(500); // 5% initial fee
    await mockConfig.transferOwnership(await timelock.getAddress());

    // 5. Setup Timelock roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, ethers.ZeroAddress); // Anyone can execute
    await timelock.revokeRole(adminRole, owner.address); // Security: owner is no longer admin

    // 6. Distribute tokens and delegate
    const amountToVoter1 = ethers.parseEther("5000000"); // 5%
    const amountToVoter2 = ethers.parseEther("1000000"); // 1%
    
    await token.transfer(voter1.address, amountToVoter1);
    await token.transfer(voter2.address, amountToVoter2);
    
    await token.connect(voter1).delegate(voter1.address);
    await token.connect(voter2).delegate(voter2.address);
    
    // Transfer treasury funds to Timelock
    const treasuryFunds = ethers.parseEther("1000000");
    await token.transfer(await timelock.getAddress(), treasuryFunds);

    return { token, timelock, governor, mockConfig, owner, proposer, voter1, voter2, receiver, other, minDelay };
  }

  describe("Proposal Lifecycle", function () {
    it("Should successfully execute a token transfer proposal", async function () {
      const { token, timelock, governor, voter1, receiver } = await loadFixture(deployGovernorFixture);
      
      const transferAmount = ethers.parseEther("1000");
      const description = "Transfer tokens to receiver";
      const calldata = token.interface.encodeFunctionData("transfer", [receiver.address, transferAmount]);
      
      // 1. Propose
      await governor.connect(voter1).propose(
        [await token.getAddress()],
        [0],
        [calldata],
        description
      );
      const proposalId = await governor.hashProposal(
        [await token.getAddress()],
        [0],
        [calldata],
        ethers.id(description)
      );
      
      // 2. Wait for voting delay
      await mine(Number(await governor.votingDelay()) + 1);
      
      // 3. Vote
      await governor.connect(voter1).castVote(proposalId, 1);
      
      // 4. Wait for voting period
      await mine(Number(await governor.votingPeriod()) + 1);
      
      // 5. Queue
      const descriptionHash = ethers.id(description);
      await governor.queue([await token.getAddress()], [0], [calldata], descriptionHash);
      
      // 6. Wait for timelock delay
      await time.increase(2 * 24 * 60 * 60 + 1);
      
      // 7. Execute
      await governor.execute([await token.getAddress()], [0], [calldata], descriptionHash);
      
      expect(await token.balanceOf(receiver.address)).to.equal(transferAmount);
    });

    it("Should successfully change a parameter via governance", async function () {
      const { timelock, governor, voter1, mockConfig } = await loadFixture(deployGovernorFixture);
      
      const newFee = 750;
      const description = "Change fee to 7.5%";
      const calldata = mockConfig.interface.encodeFunctionData("setFeePercentage", [newFee]);
      
      await governor.connect(voter1).propose([await mockConfig.getAddress()], [0], [calldata], description);
      const proposalId = await governor.hashProposal([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(voter1).castVote(proposalId, 1);
      await mine(Number(await governor.votingPeriod()) + 1);
      
      await governor.queue([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
      await time.increase(2 * 24 * 60 * 60 + 1);
      await governor.execute([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
      
      expect(await mockConfig.feePercentage()).to.equal(newFee);
    });
  });

  describe("Detailed Voting and Proposal Rules", function () {
    it("Should fail if proposer has insufficient voting power", async function () {
      const { governor, other } = await loadFixture(deployGovernorFixture);
      // 'other' has 0 tokens and no delegation
      const description = "Unauthorized proposal";
      await expect(
        governor.connect(other).propose([other.address], [0], ["0x"], description)
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });

    it("Should allow voting with Abstain and count towards quorum", async function () {
      const { governor, voter1, voter2 } = await loadFixture(deployGovernorFixture);
      
      const description = "Abstain test";
      await governor.connect(voter1).propose([voter1.address], [0], ["0x"], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], ["0x"], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      
      // Voter1 votes For (5M), Voter2 votes Abstain (1M)
      // Total quorum needed: 4% of 100M = 4M. 
      // 5M + 1M = 6M > 4M. Quorum met.
      await governor.connect(voter1).castVote(proposalId, 1); // For
      await governor.connect(voter2).castVote(proposalId, 2); // Abstain
      
      await mine(Number(await governor.votingPeriod()) + 1);
      
      const votes = await governor.proposalVotes(proposalId);
      expect(votes.abstainVotes).to.equal(ethers.parseEther("1000000"));
      expect(await governor.state(proposalId)).to.equal(4); // 4 = Succeeded
    });

    it("Should fail if someone tries to vote twice", async function () {
      const { governor, voter1 } = await loadFixture(deployGovernorFixture);
      const description = "Double vote test";
      await governor.connect(voter1).propose([voter1.address], [0], ["0x"], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], ["0x"], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(voter1).castVote(proposalId, 1);
      
      await expect(
        governor.connect(voter1).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });

    it("Should fail if someone tries to vote after the voting period has ended", async function () {
      const { governor, voter1 } = await loadFixture(deployGovernorFixture);
      const description = "Late vote test";
      await governor.connect(voter1).propose([voter1.address], [0], ["0x"], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], ["0x"], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + Number(await governor.votingPeriod()) + 2);
      
      await expect(
        governor.connect(voter1).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, "GovernorUnexpectedProposalState");
    });

    it("Should not allow queuing a proposal that hasn't passed", async function () {
      const { governor, voter1 } = await loadFixture(deployGovernorFixture);
      const description = "Premature queue test";
      await governor.connect(voter1).propose([voter1.address], [0], ["0x"], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], ["0x"], ethers.id(description));
      
      // Still in Pending or Active state
      await expect(
        governor.queue([voter1.address], [0], ["0x"], ethers.id(description))
      ).to.be.revertedWithCustomError(governor, "GovernorUnexpectedProposalState");
    });

    it("Should allow the treasury (Timelock) to hold and manage funds", async function () {
      const { token, timelock } = await loadFixture(deployGovernorFixture);
      const timelockAddress = await timelock.getAddress();
      const balance = await token.balanceOf(timelockAddress);
      expect(balance).to.equal(ethers.parseEther("1000000")); // Treasury funds transferred in fixture
    });

    it("Should demonstrate the full successful lifecycle of a parameter change", async function () {
        const { timelock, governor, voter1, mockConfig } = await loadFixture(deployGovernorFixture);
        
        const newFee = 250; // 2.5%
        const description = "Parameter change lifecycle demo";
        const calldata = mockConfig.interface.encodeFunctionData("setFeePercentage", [newFee]);
        
        // 1. Propose
        await governor.connect(voter1).propose([await mockConfig.getAddress()], [0], [calldata], description);
        const proposalId = await governor.hashProposal([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
        expect(await governor.state(proposalId)).to.equal(0); // Pending
        
        // 2. Wait for delay
        await mine(Number(await governor.votingDelay()) + 1);
        expect(await governor.state(proposalId)).to.equal(1); // Active
        
        // 3. Vote
        await governor.connect(voter1).castVote(proposalId, 1);
        
        // 4. End voting period
        await mine(Number(await governor.votingPeriod()) + 1);
        expect(await governor.state(proposalId)).to.equal(4); // Succeeded
        
        // 5. Queue
        await governor.queue([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
        expect(await governor.state(proposalId)).to.equal(5); // Queued
        
        // 6. Wait for Timelock
        await time.increase(2 * 24 * 60 * 60 + 1);
        
        // 7. Execute
        await governor.execute([await mockConfig.getAddress()], [0], [calldata], ethers.id(description));
        expect(await governor.state(proposalId)).to.equal(7); // Executed
        
        expect(await mockConfig.feePercentage()).to.equal(newFee);
    });
  });

  describe("Vote Delegation", function () {
    it("Should allow delegatee to vote on behalf of delegator", async function () {
      const { token, governor, voter1, voter2, other } = await loadFixture(deployGovernorFixture);
      
      await token.connect(voter2).delegate(other.address);
      
      const description = "Delegation test proposal";
      const calldata = "0x";
      await governor.connect(voter1).propose([voter1.address], [0], [calldata], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], [calldata], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(other).castVote(proposalId, 1);
      
      const proposal = await governor.proposalVotes(proposalId);
      expect(proposal.forVotes).to.equal(await token.balanceOf(voter2.address));
    });
  });

  describe("Proposal Failure Cases", function () {
    it("Should fail if quorum is not met", async function () {
      const { governor, voter2 } = await loadFixture(deployGovernorFixture);
      
      const description = "Quorum failure test";
      const calldata = "0x";
      await governor.connect(voter2).propose([voter2.address], [0], [calldata], description);
      const proposalId = await governor.hashProposal([voter2.address], [0], [calldata], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(voter2).castVote(proposalId, 1);
      await mine(Number(await governor.votingPeriod()) + 1);
      
      expect(await governor.state(proposalId)).to.equal(3); // 3 = Defeated
    });

    it("Should fail if proposal is defeated by majority", async function () {
      const { governor, voter1, voter2 } = await loadFixture(deployGovernorFixture);
      
      const description = "Defeat test";
      const calldata = "0x";
      await governor.connect(voter1).propose([voter1.address], [0], [calldata], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], [calldata], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(voter1).castVote(proposalId, 0); // Against
      await governor.connect(voter2).castVote(proposalId, 1); // For
      await mine(Number(await governor.votingPeriod()) + 1);
      
      expect(await governor.state(proposalId)).to.equal(3); // Defeated
    });
  });

  describe("Edge Cases", function () {
    it("Should require timelock delay to pass", async function () {
      const { governor, voter1 } = await loadFixture(deployGovernorFixture);
      const description = "Timelock delay test";
      const calldata = "0x";
      
      await governor.connect(voter1).propose([voter1.address], [0], [calldata], description);
      const proposalId = await governor.hashProposal([voter1.address], [0], [calldata], ethers.id(description));
      
      await mine(Number(await governor.votingDelay()) + 1);
      await governor.connect(voter1).castVote(proposalId, 1);
      await mine(Number(await governor.votingPeriod()) + 1);
      
      await governor.queue([voter1.address], [0], [calldata], ethers.id(description));
      
      await expect(
        governor.execute([voter1.address], [0], [calldata], ethers.id(description))
      ).to.revert(ethers);
    });

    it("Should have correct config", async function () {
      const { governor } = await loadFixture(deployGovernorFixture);
      expect(await governor.votingDelay()).to.equal(7200);
      expect(await governor.votingPeriod()).to.equal(50400);
      expect(await governor.proposalThreshold()).to.equal(ethers.parseEther("1000000"));
    });
  });
});
