// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC721 {
    function balanceOf(address owner) external view returns (uint256);

    function ownerOf(uint256 tokenId) external view returns (address);

    function transferFrom(address from, address to, uint256 tokenId) external;

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;

    function approve(address to, uint256 tokenId) external;

    function getApproved(uint256 tokenId) external view returns (address);

    function setApprovalForAll(address operator, bool _approved) external;

    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
