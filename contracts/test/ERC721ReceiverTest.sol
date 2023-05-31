// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract ERC721ReceiverAccepted {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
}

contract ERC721ReceiverRejectedWithCode {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x00000000;
    }
}

contract ERC721ReceiverRejectedWithEmptyError {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert();
    }
}

contract ERC721ReceiverRejectedWithReason {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("failed");
    }
}

contract ERC721ReceiverRejectedWithCustomError {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert ReceiveRejected("failed");
    }

    error ReceiveRejected(string reason);
}
