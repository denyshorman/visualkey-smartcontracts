// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC173 {
    function owner() external view returns (address);

    function transferOwnership(address newOwner) external;
}
