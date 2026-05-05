const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
    // 1. Загружаем адреса контрактов
    const addresses = JSON.parse(fs.readFileSync("contract-addresses.json", "utf8"));
    
    const TOKEN_ADDRESS = addresses.TOKEN_ADDRESS;
    const GOVERNOR_ADDRESS = addresses.GOVERNOR_ADDRESS;
    const BOX_ADDRESS = addresses.BOX_ADDRESS;

    const token = await ethers.getContractAt("GovernanceToken", TOKEN_ADDRESS);
    const governor = await ethers.getContractAt("MyGovernor", GOVERNOR_ADDRESS);
    const box = await ethers.getContractAt("Box", BOX_ADDRESS);

    const [deployer, voter] = await ethers.getSigners();

    console.log("Setting up voting power for voter...");
    // Передаем токены и делегируем, если еще не сделано
    if ((await token.balanceOf(voter.address)) === 0n) {
        await token.connect(deployer).transfer(voter.address, ethers.parseEther("10000000"));
    }
    await token.connect(voter).delegate(voter.address);

    // 2. Создаем предложение (Proposal)
    console.log("Creating proposal to store 42 in Box...");
    const newValue = 42;
    const calldata = box.interface.encodeFunctionData("store", [newValue]);
    const description = "Change Box value to " + newValue + " (Time: " + Date.now() + ")";

    const proposeTx = await governor.connect(voter).propose(
        [BOX_ADDRESS],
        [0],
        [calldata],
        description
    );
    const receipt = await proposeTx.wait();
    
    // Получаем ID предложения из логов
    const proposalId = receipt.logs[0].args.proposalId;
    console.log("-----------------------------------------");
    console.log("PROPOSAL CREATED!");
    console.log("Proposal ID:", proposalId.toString());
    console.log("-----------------------------------------");

    // 3. Перематываем блоки, чтобы предложение стало АКТИВНЫМ (Voting Delay)
    // В нашем случае это 1 день = 7200 блоков
    console.log("Moving blocks forward (Voting Delay)...");
    const votingDelay = await governor.votingDelay();
    await network.provider.send("hardhat_mine", [ethers.toBeHex(Number(votingDelay) + 1)]);

    console.log("-----------------------------------------");
    console.log("SUCCESS: Proposal is now ACTIVE!");
    console.log("You can now VOTE for it in your frontend dashboard.");
    console.log("-----------------------------------------");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});