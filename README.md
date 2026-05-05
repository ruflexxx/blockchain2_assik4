# Blockchain 2 - Assignment 4

DAO governance project built with Hardhat, OpenZeppelin, and a lightweight browser dashboard.

## Team

- Students: Almadi, Radmir
- Group: SE-2417

## Included Features

- Governance token with `ERC20Permit` and `ERC20Votes`
- Timelock-based governor contract
- Treasury contract for ETH and ERC20 withdrawals
- Token vesting contract for team allocation
- Example governed contracts: `Box` and `MockConfig`
- Hardhat tests for governance flows, treasury control, delegation, and vesting
- Simple frontend for wallet connection, delegation, and proposal voting

## Project Structure

- `contracts/` - Solidity contracts
- `scripts/deploy.js` - full deployment script for the DAO stack
- `scripts/send-tokens.js` - utility script to transfer GTK from a funded local signer
- `test/` - Hardhat test suite
- `index.html`, `index.css`, `app.js` - browser dashboard

## Requirements

- Node.js `18+`
- npm

## Install

```bash
npm install
```

## Common Commands

```bash
npm run compile
npm run test
npm run node
npm run deploy
npm run deploy:localhost
npm run send:tokens:localhost
```

## Local Workflow

1. Install dependencies with `npm install`.
2. Start a local Hardhat chain with `npm run node`.
3. In another terminal, deploy contracts with `npm run deploy:localhost`.
4. Open `index.html` in a browser with MetaMask connected to the local Hardhat network.
5. Delegate voting power to yourself in the UI before trying to vote.

## Deployment Notes

`scripts/deploy.js` now deploys:

- `Treasury`
- `Box`
- `MockConfig`
- `TimelockController`
- `GovernanceToken`
- `TokenVesting`
- `MyGovernor`

The script also:

- transfers the team allocation into the vesting contract
- transfers governed contract ownership to the timelock
- grants governance roles to the governor
- writes deployment metadata to `contract-addresses.json`
- injects the latest token and governor addresses into `app.js`

## Optional Environment Variables

You can customize deployment with standard shell environment variables before running the deploy script:

- `TEAM_BENEFICIARY`
- `COMMUNITY_ADDRESS`
- `LIQUIDITY_ADDRESS`
- `INITIAL_FEE_BPS`
- `TIMELOCK_DELAY`
- `VESTING_START`
- `VESTING_DURATION`
- `RECIPIENT_ADDRESS`
- `AMOUNT_GTK`
