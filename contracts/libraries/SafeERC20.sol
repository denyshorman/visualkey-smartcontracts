// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "../interfaces/IERC20.sol";
import {Address} from "./Address.sol";

library SafeERC20 {
    using Address for address;

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        callOptionalReturn(token, abi.encodeWithSelector(token.transfer.selector, to, amount));
    }

    function callOptionalReturn(IERC20 token, bytes memory data) private {
        require(address(token).isContract());

        (bool success, bytes memory returndata) = address(token).call(data);
        require(success);

        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)));
        }
    }
}
