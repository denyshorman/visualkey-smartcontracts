// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC1363Receiver} from "../interfaces/IERC1363Receiver.sol";
import {IERC1363Spender} from "../interfaces/IERC1363Spender.sol";
import {Address} from "./Address.sol";

library ERC1363Utils {
    using Address for address;

    error ERC1363InvalidReceiver(address receiver);
    error ERC1363InvalidSpender(address spender);

    function checkOnERC1363TransferReceived(
        address operator,
        address from,
        address to,
        uint256 amount,
        bytes memory data
    ) internal {
        if (to.isExternallyOwnedAccount()) {
            revert ERC1363InvalidReceiver(to);
        }

        try IERC1363Receiver(to).onTransferReceived(operator, from, amount, data) returns (bytes4 retval) {
            if (retval != IERC1363Receiver.onTransferReceived.selector) {
                revert ERC1363InvalidReceiver(to);
            }
        } catch (bytes memory reason) {
            if (reason.length == 0) {
                revert ERC1363InvalidReceiver(to);
            } else {
                assembly ("memory-safe") {
                    revert(add(32, reason), mload(reason))
                }
            }
        }
    }

    function checkOnERC1363ApprovalReceived(
        address operator,
        address spender,
        uint256 amount,
        bytes memory data
    ) internal {
        if (spender.isExternallyOwnedAccount()) {
            revert ERC1363InvalidSpender(spender);
        }

        try IERC1363Spender(spender).onApprovalReceived(operator, amount, data) returns (bytes4 retval) {
            if (retval != IERC1363Spender.onApprovalReceived.selector) {
                revert ERC1363InvalidSpender(spender);
            }
        } catch (bytes memory reason) {
            if (reason.length == 0) {
                revert ERC1363InvalidSpender(spender);
            } else {
                assembly ("memory-safe") {
                    revert(add(32, reason), mload(reason))
                }
            }
        }
    }
}