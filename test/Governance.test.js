const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Governance System", function () {
  async function deployFixture() {
    const [owner, team, treasury, community, liquidity, user1, user2] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy(
      owner.address,
       treasury.address,
      community.address,
      liquidity.address
    );

    // Deploy Vesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    const startTime = (await time.latest()) + 60; // Start in 1 minute
    const duration = 365 * 24 * 60 * 60; // 12 months
    const vesting = await TokenVesting.deploy(
      await token.getAddress(),
      team.address,
      startTime,
      duration
    );

    // Transfer team tokens from owner to vesting contract
    const teamAmount = (await token.totalSupply() * 40n) / 100n;
    await token.transfer(await vesting.getAddress(), teamAmount);

    return { token, vesting, owner, team, treasury, community, liquidity, user1, user2, startTime, duration, teamAmount };
  }

  describe("GovernanceToken Distribution", function () {
    it("Should distribute tokens correctly", async function () {
      const { token, treasury, community, liquidity } = await loadFixture(deployFixture);
      
      const totalSupply = await token.totalSupply();
      expect(await token.balanceOf(treasury.address)).to.equal((totalSupply * 30n) / 100n);
      expect(await token.balanceOf(community.address)).to.equal((totalSupply * 20n) / 100n);
      expect(await token.balanceOf(liquidity.address)).to.equal((totalSupply * 10n) / 100n);
    });
  });

  describe("Delegation and Voting Power", function () {
    it("Should allow delegation and track voting power", async function () {
      const { token, community, user1 } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1000");
      await token.connect(community).transfer(user1.address, amount);

      expect(await token.getVotes(user1.address)).to.equal(0);

      await token.connect(user1).delegate(user1.address);
      expect(await token.getVotes(user1.address)).to.equal(amount);
    });

    it("Should handle voting power snapshots", async function () {
      const { token, community, user1, user2 } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("1000");
      await token.connect(community).transfer(user1.address, amount);
      await token.connect(user1).delegate(user1.address);

      const block1 = await ethers.provider.getBlockNumber();
      
      await token.connect(user1).transfer(user2.address, amount / 2n);

      expect(await token.getVotes(user1.address)).to.equal(amount / 2n);
      expect(await token.getPastVotes(user1.address, block1)).to.equal(amount);
    });
  });

  describe("Permit Signatures (EIP-2612)", function () {
    it("Should allow gasless approval via permit", async function () {
      const { token, owner, user1 } = await loadFixture(deployFixture);

      const amount = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      
      const domain = {
        name: await token.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        owner: owner.address,
        spender: user1.address,
        value: amount,
        nonce: await token.nonces(owner.address),
        deadline: deadline,
      };

      const signature = await owner.signTypedData(domain, types, value);
      const sig = ethers.Signature.from(signature);

      await token.permit(owner.address, user1.address, amount, deadline, sig.v, sig.r, sig.s);
      
      expect(await token.allowance(owner.address, user1.address)).to.equal(amount);
    });
  });

  describe("Vesting Schedule", function () {
    it("Should not release tokens before start time", async function () {
      const { vesting } = await loadFixture(deployFixture);
      await expect(vesting.release()).to.be.revertedWith("No tokens are due for release");
    });

    it("Should release tokens linearly", async function () {
      const { vesting, token, team, startTime, duration, teamAmount } = await loadFixture(deployFixture);
      
      await time.increaseTo(startTime + duration / 2);
      await vesting.release();
      
      const released = await token.balanceOf(team.address);
      expect(released).to.be.closeTo(teamAmount / 2n, ethers.parseEther("100"));
    });

    it("Should release all tokens after duration", async function () {
      const { vesting, token, team, startTime, duration, teamAmount } = await loadFixture(deployFixture);
      
      await time.increaseTo(startTime + duration + 1);
      await vesting.release();
      
      expect(await token.balanceOf(team.address)).to.equal(teamAmount);
    });

    it("Should track released amount correctly", async function () {
      const { vesting, startTime, duration, teamAmount } = await loadFixture(deployFixture);
      
      await time.increaseTo(startTime + duration / 4);
      await vesting.release();
      
      const firstRelease = await vesting.released();
      expect(firstRelease).to.be.closeTo(teamAmount / 4n, ethers.parseEther("100"));
      
      await time.increaseTo(startTime + duration / 2);
      await vesting.release();
      
      const secondRelease = await vesting.released();
      expect(secondRelease).to.be.closeTo(teamAmount / 2n, ethers.parseEther("100"));
    });
  });
});
