// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library MessageHashUtils {
    function toTypedDataHash(bytes32 domainSeparator, bytes32 hash) internal pure returns (bytes32 digest) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, hex"19_01")
            mstore(add(ptr, 0x02), domainSeparator)
            mstore(add(ptr, 0x22), hash)
            digest := keccak256(ptr, 0x42)
        }
    }
}
