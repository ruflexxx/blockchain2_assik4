// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract MockConfig is Ownable {
    uint256 public feePercentage;

    event FeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(uint256 _initialFee) Ownable(msg.sender) {
        feePercentage = _initialFee;
    }

    function setFeePercentage(uint256 _newFee) external onlyOwner {
        require(_newFee <= 1000, "Fee too high"); // max 10%
        uint256 oldFee = feePercentage;
        feePercentage = _newFee;
        emit FeeUpdated(oldFee, _newFee);
    }
}
