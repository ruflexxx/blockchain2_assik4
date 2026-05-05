// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Treasury is Ownable {
    using SafeERC20 for IERC20;

    event Withdraw(address indexed to, uint256 amount);
    event WithdrawERC20(address indexed token, address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // Allow the contract to receive ETH
    receive() external payable {}

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        emit Withdraw(to, amount);
    }

    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");

        IERC20(token).safeTransfer(to, amount);
        emit WithdrawERC20(token, to, amount);
    }
}
