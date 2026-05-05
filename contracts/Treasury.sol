// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Treasury is Ownable {
    event Withdraw(address indexed to, uint256 amount);
    event WithdrawERC20(address indexed token, address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // Allow the contract to receive ETH
    receive() external payable {}

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        emit Withdraw(to, amount);
    }

    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).transfer(to, amount);
        emit WithdrawERC20(token, to, amount);
    }
}
