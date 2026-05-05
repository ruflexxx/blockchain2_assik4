const GOVERNOR_ABI = [
    "function state(uint256 proposalId) view returns (uint8)",
    "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
    "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
    "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
    "function proposalDeadline(uint256 proposalId) view returns (uint256)",
    "function quorum(uint256 blockNumber) view returns (uint256)",
    "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)"
];

const TOKEN_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function getVotes(address account) view returns (uint256)",
    "function delegates(address account) view returns (address)",
    "function delegate(address delegatee) returns ()"
];

const STATE_ENUM = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];

let provider, signer, governorContract, tokenContract;
let userAddress;

// ВАЖНО: Эти адреса соответствуют вашему contract-addresses.json
const GOVERNOR_ADDRESS = "0x9E545E3C0baAB3E08CdfD552C960A1050f373042"; 
const TOKEN_ADDRESS = "0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690";    

function logStatus(msg, isError = false) {
    console.log(msg);
    const statusEl = document.getElementById('statusMsg');
    if (statusEl) {
        statusEl.innerText = msg;
        statusEl.style.color = isError ? "#ef4444" : "#22c55e";
    }
}

async function init() {
    logStatus("Initializing...");
    if (window.ethereum) {
        try {
            provider = new ethers.providers.Web3Provider(window.ethereum);
            
            document.getElementById('connectBtn').onclick = connectWallet;
            document.getElementById('delegateBtn').onclick = handleDelegate;

            const accounts = await provider.listAccounts();
            if (accounts.length > 0) {
                await setupAccount(accounts[0]);
            } else {
                logStatus("Please connect your wallet.");
            }
        } catch (err) {
            logStatus("Init Error: " + err.message, true);
        }
    } else {
        logStatus("No MetaMask found!", true);
    }
}

async function connectWallet() {
    try {
        logStatus("Connecting...");
        const accounts = await provider.send("eth_requestAccounts", []);
        await setupAccount(accounts[0]);
        logStatus("Connected!");
    } catch (err) {
        logStatus("Connection failed", true);
    }
}

async function setupAccount(account) {
    userAddress = account;
    signer = provider.getSigner();
    document.getElementById('connectBtn').innerText = `${account.substring(0, 6)}...`;
    
    try {
        governorContract = new ethers.Contract(GOVERNOR_ADDRESS, GOVERNOR_ABI, signer);
        tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
        await updateStats();
        await loadProposals();
    } catch (err) {
        logStatus("Contract setup failed", true);
    }
}

async function updateStats() {
    try {
        const balance = await tokenContract.balanceOf(userAddress);
        const votes = await tokenContract.getVotes(userAddress);
        const delegate = await tokenContract.delegates(userAddress);

        document.getElementById('tokenBalance').innerText = `${ethers.utils.formatEther(balance)} GTK`;
        document.getElementById('votingPower').innerText = `${ethers.utils.formatEther(votes)} VP`;
        document.getElementById('delegatedTo').innerText = delegate === "0x0000000000000000000000000000000000000000" ? "None" : delegate.substring(0, 10) + "...";
    } catch (err) {
        logStatus("Stats update failed", true);
    }
}

async function handleDelegate() {
    const addr = document.getElementById('delegateAddr').value;
    if (!ethers.utils.isAddress(addr)) return logStatus("Invalid address", true);

    try {
        logStatus("Delegating...");
        const tx = await tokenContract.delegate(addr);
        await tx.wait();
        logStatus("Delegation complete!");
        await updateStats();
    } catch (err) {
        logStatus("Delegation failed", true);
    }
}

async function loadProposals() {
    const list = document.getElementById('proposalsList');
    list.innerHTML = "Loading...";

    try {
        const filter = governorContract.filters.ProposalCreated();
        // Ищем с блока 0, чтобы увидеть предложения после перемотки времени
        const events = await governorContract.queryFilter(filter, 0);

        if (events.length === 0) {
            list.innerHTML = "No proposals found.";
            return;
        }

        list.innerHTML = "";
        for (const event of events.reverse()) {
            const { proposalId, description } = event.args;
            const state = await governorContract.state(proposalId);
            const votes = await governorContract.proposalVotes(proposalId);
            
            const card = document.createElement('div');
            card.className = 'proposal-card animate-in';
            card.innerHTML = `
                <h3>${description}</h3>
                <p>Status: ${STATE_ENUM[state]}</p>
                <p>For: ${ethers.utils.formatEther(votes.forVotes)} | Against: ${ethers.utils.formatEther(votes.againstVotes)}</p>
                ${state === 1 ? `
                    <div class="vote-actions">
                        <button onclick="vote('${proposalId}', 1)" class="vote-btn for">For</button>
                        <button onclick="vote('${proposalId}', 0)" class="vote-btn against">Against</button>
                    </div>
                ` : ''}
            `;
            list.appendChild(card);
        }
    } catch (err) {
        logStatus("Load Proposals failed", true);
    }
}

async function vote(id, support) {
    try {
        logStatus("Voting...");
        const tx = await governorContract.castVote(id, support);
        await tx.wait();
        logStatus("Voted successfully!");
        await loadProposals();
    } catch (err) {
        logStatus("Vote failed", true);
    }
}

window.init = init;
window.vote = vote;
window.onload = init;
