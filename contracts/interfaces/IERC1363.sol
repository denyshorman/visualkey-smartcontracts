// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC165} from "./IERC165.sol";
import {IERC20} from "./IERC20.sol";

interface IERC1363 is IERC20, IERC165 {
    function transferAndCall(address to, uint256 amount) external returns (bool);

    function transferAndCall(address to, uint256 amount, bytes calldata data) external returns (bool);

    function transferFromAndCall(address from, address to, uint256 amount) external returns (bool);

    function transferFromAndCall(address from, address to, uint256 amount, bytes calldata data) external returns (bool);

    function approveAndCall(address spender, uint256 amount) external returns (bool);

    function approveAndCall(address spender, uint256 amount, bytes calldata data) external returns (bool);
}
