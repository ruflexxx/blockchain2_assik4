// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Box is Ownable {
    uint256 private _value;

    event ValueChanged(uint256 newValue);

    constructor() Ownable(msg.sender) {}

    function store(uint256 newValue) public onlyOwner {
        _value = newValue;
        emit ValueChanged(newValue);
    }

    function retrieve() public view returns (uint256) {
        return _value;
    }
}
