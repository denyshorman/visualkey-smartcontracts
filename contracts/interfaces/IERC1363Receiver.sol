// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC1363Receiver {
    function onTransferReceived(address operator, address from, uint256 amount, bytes calldata data) external returns (bytes4);
}
