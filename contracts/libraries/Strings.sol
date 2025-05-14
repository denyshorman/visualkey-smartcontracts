// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "./Math.sol";

library Strings {
    //#region Constants
    bytes16 private constant _HEX_SYMBOLS = "0123456789abcdef";
    //#endregion

    //#region Errors
    error HexLengthInsufficient();
    //#endregion

    //#region Functions
    function toString(uint256 value) internal pure returns (string memory) {
        unchecked {
            uint256 length = Math.log10(value) + 1;
            string memory buffer = new string(length);
            uint256 ptr;
            assembly ("memory-safe") {
                ptr := add(buffer, add(32, length))
            }
            while (true) {
                ptr--;
                assembly ("memory-safe") {
                    mstore8(ptr, byte(mod(value, 10), _HEX_SYMBOLS))
                }
                value /= 10;
                if (value == 0) break;
            }
            return buffer;
        }
    }

    function toHexString(uint256 value, uint256 length) internal pure returns (string memory) {
        bytes memory buffer = new bytes(2 * length + 2);

        buffer[0] = "0";
        buffer[1] = "x";

        for (uint256 i = 2 * length + 1; i > 1; i--) {
            buffer[i] = _HEX_SYMBOLS[value & 0xf];
            value >>= 4;
        }

        if (value != 0) {
            revert HexLengthInsufficient();
        }

        return string(buffer);
    }
    //#endregion
}
