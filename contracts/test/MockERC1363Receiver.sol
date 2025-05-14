// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {IERC1363Receiver} from "../interfaces/IERC1363Receiver.sol";

contract MockERC1363Receiver is IERC1363Receiver {
    event Received(address operator, address from, uint256 amount, bytes data);

    function onTransferReceived(address operator, address from, uint256 amount, bytes calldata data) external override returns (bytes4) {
        emit Received(operator, from, amount, data);
        return IERC1363Receiver.onTransferReceived.selector;
    }
}
