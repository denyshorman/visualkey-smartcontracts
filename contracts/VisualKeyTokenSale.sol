// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title TokenSale
 * @dev This contract allows the owner to sell a specific ERC20 token (VKEY) for ETH.
 * The owner can set the price, withdraw collected ETH, and withdraw any other ERC20 tokens
 * sent to this contract by mistake.
 *
 * HOW TO USE:
 * 1. Deploy this contract, providing the address of your VKEY token contract and the initial price.
 * The price is set in 'wei per VKEY token'. For a 1:1 ratio (1 ETH for 1 VKEY), the initial price
 * should be 1 ether (1_000_000_000_000_000_000).
 * 2. Transfer the VKEY tokens you want to sell TO THIS CONTRACT's address.
 * 3. Users can now buy tokens by sending ETH to this contract.
 */
contract VisualKeyTokenSale {
    //#region State
    IERC20 public immutable token;
    address private _owner;

    /// @dev The price of one VKEY token, denominated in wei.
    /// @notice Example: If 1 VKEY costs 1 ETH, this should be set to 1e18.
    /// If 1 VKEY costs 0.5 ETH, this should be set to 5e17.
    uint256 private weiPerVkey;
    //#endregion

    //#region Events
    event TokensPurchased(address indexed purchaser, uint256 ethAmount, uint256 tokenAmount);
    event PriceUpdated(uint256 newWeiPerVkey);
    event EthWithdrawn(address indexed to, uint256 amount);
    event Erc20Withdrawn(address indexed tokenAddress, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    //#endregion

    //#region Errors
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientEthSent();
    error InsufficientTokensInContract(uint256 available, uint256 required);
    error TransferFailed();
    //#endregion

    //#region Constructor
    /**
     * @param tokenAddress The address of the VKEY (ERC20) token.
     * @param initialWeiPerVkey The initial price in wei for one full VKEY token.
     */
    constructor(address owner_, address tokenAddress, uint256 initialWeiPerVkey) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        if (initialWeiPerVkey == 0) revert ZeroAmount();

        _owner = owner_;
        token = IERC20(tokenAddress);
        weiPerVkey = initialWeiPerVkey;
    }
    //#endregion

    //#region Modifiers
    modifier onlyOwner() {
        if (msg.sender != _owner) revert Unauthorized();
        _;
    }
    //#endregion

    //#region Public API
    /**
     * @dev Receive ETH and trigger the token purchase.
     */
    receive() external payable {
        buyTokens();
    }

    /**
     * @dev The core function for buying tokens.
     * A user sends ETH and receives VKEY tokens in return based on the current price.
     */
    function buyTokens() public payable {
        uint256 ethAmount = msg.value;
        if (ethAmount == 0) revert InsufficientEthSent();

        uint256 tokensToBuy = (ethAmount * 1e18) / weiPerVkey;
        if (tokensToBuy == 0) revert InsufficientEthSent();

        uint256 contractTokenBalance = token.balanceOf(address(this));
        if (contractTokenBalance < tokensToBuy) {
            revert InsufficientTokensInContract(contractTokenBalance, tokensToBuy);
        }

        bool sent = token.transfer(msg.sender, tokensToBuy);
        if (!sent) revert TransferFailed();

        emit TokensPurchased(msg.sender, ethAmount, tokensToBuy);
    }
    //#endregion

    //#region Administrator API
    /**
     * @dev Returns the current price of the VKEY token in wei.
     * @return The price in wei for one VKEY token.
     */
    function getPrice() external view returns (uint256) {
        return weiPerVkey;
    }

    /**
     * @dev Updates the price of the VKEY token.
     * @param newWeiPerVkey The new price in wei for one VKEY token.
     */
    function setPrice(uint256 newWeiPerVkey) external onlyOwner {
        if (newWeiPerVkey == 0) revert ZeroAmount();
        weiPerVkey = newWeiPerVkey;
        emit PriceUpdated(newWeiPerVkey);
    }

    /**
     * @dev Withdraws the entire ETH balance of the contract to the owner.
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();

        (bool success,) = _owner.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit EthWithdrawn(_owner, balance);
    }

    /**
     * @dev Withdraws any ERC20 token from this contract.
     * Useful if someone accidentally sends other tokens here.
     * @param tokenContractAddress The address of the ERC20 token to withdraw.
     */
    function withdrawERC20(address tokenContractAddress, uint256 amount) external onlyOwner {
        if (tokenContractAddress == address(0)) revert ZeroAddress();

        IERC20 foreignToken = IERC20(tokenContractAddress);

        uint256 balance = foreignToken.balanceOf(address(this));

        if (balance == 0) revert InsufficientTokensInContract(0, amount);

        if (amount == 0 || amount == type(uint256).max) {
            amount = balance;
        }

        if (amount > balance) revert InsufficientTokensInContract(balance, amount);

        bool sent = foreignToken.transfer(_owner, amount);

        if (!sent) revert TransferFailed();

        emit Erc20Withdrawn(tokenContractAddress, _owner, amount);
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view returns (address) {
        return _owner;
    }

    /**
     * @dev Transfers ownership of the contract to a new address.
     * @param newOwner The address of the new potential owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        _owner = newOwner;
    }
    //#endregion
}