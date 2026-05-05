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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EVENT_LOOKBACK_BLOCKS = 5000;

let provider;
let signer;
let governorContract;
let tokenContract;
let userAddress;

// These values are updated automatically by scripts/deploy.js.
const GOVERNOR_ADDRESS = "";
const TOKEN_ADDRESS = "";

function shortAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatToken(value, suffix = "") {
    const formatted = Number.parseFloat(ethers.utils.formatEther(value)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
    });

    return suffix ? `${formatted} ${suffix}` : formatted;
}

function getReadableError(error) {
    return error?.reason || error?.data?.message || error?.message || "Unknown error";
}

function hasConfiguredContracts() {
    return ethers.utils.isAddress(GOVERNOR_ADDRESS) && ethers.utils.isAddress(TOKEN_ADDRESS);
}

function renderEmptyState(message) {
    const list = document.getElementById("proposalsList");
    if (list) {
        list.innerHTML = `<div class="empty-state">${message}</div>`;
    }
}

function stateToBadge(state) {
    switch (state) {
        case 0:
            return "badge-pending";
        case 1:
            return "badge-active";
        case 3:
            return "badge-defeated";
        case 4:
        case 5:
            return "badge-executed";
        case 7:
            return "badge-success";
        default:
            return "badge-neutral";
    }
}

function logStatus(message, isError = false) {
    console.log(message);
    const statusEl = document.getElementById("statusMsg");
    if (statusEl) {
        statusEl.innerText = message;
        statusEl.classList.toggle("status-error", isError);
        statusEl.classList.toggle("status-success", !isError);
    }
}

async function init() {
    logStatus("Initializing...");
    document.getElementById("connectBtn").onclick = connectWallet;
    document.getElementById("delegateBtn").onclick = () => handleDelegate();
    document.getElementById("delegateSelfBtn").onclick = () => {
        if (!userAddress) {
            logStatus("Connect your wallet before self-delegating.", true);
            return;
        }

        handleDelegate(userAddress);
    };
    document.getElementById("refreshBtn").onclick = loadProposals;

    if (!window.ethereum) {
        logStatus("MetaMask was not detected in this browser.", true);
        renderEmptyState("MetaMask is required to read proposals and vote.");
        return;
    }

    try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        window.ethereum.on("accountsChanged", handleAccountsChanged);
        window.ethereum.on("chainChanged", () => window.location.reload());

        if (!hasConfiguredContracts()) {
            logStatus("Contracts are not configured yet. Run the deploy script first.", true);
            renderEmptyState("Run npm run deploy or npm run deploy:localhost to inject live addresses.");
        }

        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
            await setupAccount(accounts[0]);
        } else if (hasConfiguredContracts()) {
            renderEmptyState("Connect your wallet to load DAO proposals.");
            logStatus("Connect your wallet to continue.");
        }
    } catch (error) {
        logStatus(`Init error: ${getReadableError(error)}`, true);
    }
}

async function connectWallet() {
    try {
        logStatus("Connecting...");
        const accounts = await provider.send("eth_requestAccounts", []);
        await setupAccount(accounts[0]);
        logStatus("Wallet connected.");
    } catch (error) {
        logStatus(`Connection failed: ${getReadableError(error)}`, true);
    }
}

async function setupAccount(account) {
    userAddress = account;
    signer = provider.getSigner();
    document.getElementById("connectBtn").innerText = shortAddress(account);

    try {
        const network = await provider.getNetwork();
        document.getElementById("networkValue").innerText = `${network.name} (${network.chainId})`;
        document.getElementById("walletValue").innerText = shortAddress(account);

        if (!hasConfiguredContracts()) {
            return;
        }

        governorContract = new ethers.Contract(GOVERNOR_ADDRESS, GOVERNOR_ABI, signer);
        tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

        await Promise.all([updateStats(), loadProposals()]);
    } catch (error) {
        logStatus(`Contract setup failed: ${getReadableError(error)}`, true);
    }
}

async function updateStats() {
    if (!tokenContract || !userAddress) {
        return;
    }

    try {
        const [balance, votes, delegate] = await Promise.all([
            tokenContract.balanceOf(userAddress),
            tokenContract.getVotes(userAddress),
            tokenContract.delegates(userAddress),
        ]);

        document.getElementById("tokenBalance").innerText = formatToken(balance, "GTK");
        document.getElementById("votingPower").innerText = formatToken(votes, "VP");
        document.getElementById("delegatedTo").innerText =
            delegate === ZERO_ADDRESS ? "Not delegated" : shortAddress(delegate);
    } catch (error) {
        logStatus(`Stats update failed: ${getReadableError(error)}`, true);
    }
}

async function handleDelegate(delegatee = null) {
    if (!tokenContract) {
        logStatus("Deploy and connect contracts before delegating.", true);
        return;
    }

    const targetAddress = delegatee || document.getElementById("delegateAddr").value.trim();
    if (!ethers.utils.isAddress(targetAddress)) {
        logStatus("Enter a valid delegate address.", true);
        return;
    }

    try {
        logStatus("Delegating...");
        const tx = await tokenContract.delegate(targetAddress);
        await tx.wait();
        logStatus(`Delegation complete: ${shortAddress(targetAddress)}`);
        await updateStats();
    } catch (error) {
        logStatus(`Delegation failed: ${getReadableError(error)}`, true);
    }
}

async function loadProposals() {
    const list = document.getElementById("proposalsList");
    if (!list) {
        return;
    }

    if (!governorContract || !provider) {
        renderEmptyState("Connect your wallet after deploying contracts to see live proposals.");
        return;
    }

    list.innerHTML = "Loading...";

    try {
        const filter = governorContract.filters.ProposalCreated();
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(latestBlock - EVENT_LOOKBACK_BLOCKS, 0);
        const events = await governorContract.queryFilter(filter, fromBlock, latestBlock);

        if (events.length === 0) {
            renderEmptyState("No proposals found in the recent block window.");
            return;
        }

        list.innerHTML = "";
        for (const event of events.reverse()) {
            const { proposalId, description } = event.args;
            const [state, votes, snapshot, deadline] = await Promise.all([
                governorContract.state(proposalId),
                governorContract.proposalVotes(proposalId),
                governorContract.proposalSnapshot(proposalId),
                governorContract.proposalDeadline(proposalId),
            ]);

            const stateLabel = STATE_ENUM[state] || "Unknown";
            const badgeClass = stateToBadge(state);
            const card = document.createElement("div");
            card.className = "proposal-card animate-in";
            card.innerHTML = `
                <div class="proposal-header">
                    <div>
                        <h3>${description}</h3>
                        <p class="proposal-meta mono">Proposal ID: ${proposalId.toString()}</p>
                    </div>
                    <span class="badge ${badgeClass}">${stateLabel}</span>
                </div>
                <p class="proposal-meta">Snapshot block: ${snapshot.toString()} | Deadline block: ${deadline.toString()}</p>
                <p class="proposal-meta">For: ${formatToken(votes.forVotes)} | Against: ${formatToken(votes.againstVotes)} | Abstain: ${formatToken(votes.abstainVotes)}</p>
                ${state === 1 ? `
                    <div class="vote-actions">
                        <button onclick="vote('${proposalId}', 1)" class="vote-btn for">For</button>
                        <button onclick="vote('${proposalId}', 0)" class="vote-btn against">Against</button>
                        <button onclick="vote('${proposalId}', 2)" class="vote-btn abstain">Abstain</button>
                    </div>
                ` : ""}
            `;
            list.appendChild(card);
        }
    } catch (error) {
        logStatus(`Load proposals failed: ${getReadableError(error)}`, true);
        renderEmptyState("Failed to load proposals from the connected network.");
    }
}

async function vote(id, support) {
    try {
        logStatus("Voting...");
        const tx = await governorContract.castVote(id, support);
        await tx.wait();
        logStatus("Vote submitted successfully.");
        await Promise.all([loadProposals(), updateStats()]);
    } catch (error) {
        logStatus(`Vote failed: ${getReadableError(error)}`, true);
    }
}

async function handleAccountsChanged(accounts) {
    if (!accounts.length) {
        userAddress = null;
        governorContract = null;
        tokenContract = null;
        document.getElementById("connectBtn").innerText = "Connect Wallet";
        document.getElementById("walletValue").innerText = "Not connected";
        renderEmptyState("Reconnect your wallet to continue.");
        logStatus("Wallet disconnected.", true);
        return;
    }

    await setupAccount(accounts[0]);
}

window.init = init;
window.vote = vote;
window.onload = init;
