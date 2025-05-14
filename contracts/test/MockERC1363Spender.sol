// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {IERC1363Spender} from "../interfaces/IERC1363Spender.sol";

contract MockERC1363Spender is IERC1363Spender {
    event Approved(address owner, uint256 amount, bytes data);

    function onApprovalReceived(address owner, uint256 amount, bytes calldata data) external override returns (bytes4) {
        emit Approved(owner, amount, data);
        return IERC1363Spender.onApprovalReceived.selector;
    }
}
