// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {IERC20} from "../interfaces/IERC20.sol";
import {IERC3156FlashBorrower} from "../interfaces/IERC3156FlashBorrower.sol";

contract MockERC3156FlashBorrower is IERC3156FlashBorrower {
    event LoanReceived(address initiator, address token, uint256 amount, uint256 fee, bytes data);

    bytes32 constant internal CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    bytes32 constant internal CALLBACK_FAILURE = keccak256("ERC3156FlashBorrower.onFlashLoan.Failure");

    IERC20 public immutable loanToken;
    bool public approvePayback;

    constructor(address _loanToken, bool _approvePayback) {
        loanToken = IERC20(_loanToken);
        approvePayback = _approvePayback;
    }

    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data) external override returns (bytes32) {
        require(token == address(loanToken), "Unsupported token");
        emit LoanReceived(initiator, token, amount, fee, data);

        if (approvePayback) {
            uint256 totalRepayment = amount + fee;
            require(loanToken.approve(msg.sender, totalRepayment), "Approval failed");
            return CALLBACK_SUCCESS;
        } else {
            return CALLBACK_FAILURE;
        }
    }

    receive() external payable {}
}
