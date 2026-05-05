// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public immutable duration;
    uint256 public released;

    event TokensReleased(address beneficiary, uint256 amount);

    constructor(
        address _token,
        address _beneficiary,
        uint256 _start,
        uint256 _duration
    ) Ownable(msg.sender) {
        require(_token != address(0), "Token address cannot be 0");
        require(_beneficiary != address(0), "Beneficiary address cannot be 0");
        token = IERC20(_token);
        beneficiary = _beneficiary;
        start = _start;
        duration = _duration;
    }

    function release() public {
        uint256 unreleased = _releasableAmount();
        require(unreleased > 0, "No tokens are due for release");

        released += unreleased;
        token.safeTransfer(beneficiary, unreleased);

        emit TokensReleased(beneficiary, unreleased);
    }

    function _releasableAmount() internal view returns (uint256) {
        return _vestedAmount() - released;
    }

    function _vestedAmount() internal view returns (uint256) {
        uint256 totalBalance = token.balanceOf(address(this)) + released;

        if (block.timestamp < start) {
            return 0;
        } else if (block.timestamp >= start + duration) {
            return totalBalance;
        } else {
            return (totalBalance * (block.timestamp - start)) / duration;
        }
    }

}
