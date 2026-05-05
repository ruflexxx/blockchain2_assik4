// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    constructor(
        address teamVesting,
        address treasury,
        address community,
        address liquidity
    )
        ERC20("Governance Token", "GTK")
        ERC20Permit("Governance Token")
        Ownable(msg.sender)
    {
        uint256 totalSupply = 100_000_000 * 10**decimals();
        
        // 40% Team
        _mint(teamVesting, (totalSupply * 40) / 100);
        // 30% Treasury
        _mint(treasury, (totalSupply * 30) / 100);
        // 20% Community
        _mint(community, (totalSupply * 20) / 100);
        // 10% Liquidity
        _mint(liquidity, (totalSupply * 10) / 100);
    }
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
