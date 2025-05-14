// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC1363} from "./interfaces/IERC1363.sol";
import {IERC165} from "./interfaces/IERC165.sol";
import {IERC173} from "./interfaces/IERC173.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IERC20Burnable} from "./interfaces/IERC20Burnable.sol";
import {IERC20Metadata} from "./interfaces/IERC20Metadata.sol";
import {IERC20Permit} from "./interfaces/IERC20Permit.sol";
import {IERC3156FlashBorrower} from "./interfaces/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "./interfaces/IERC3156FlashLender.sol";
import {IERC5267} from "./interfaces/IERC5267.sol";
import {IERC721} from "./interfaces/IERC721.sol";
import {ECDSA} from "./libraries/ECDSA.sol";
import {ERC1363Utils} from "./libraries/ERC1363Utils.sol";
import {MessageHashUtils} from "./libraries/MessageHashUtils.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

contract VisualKeyToken is IERC20, IERC20Burnable, IERC20Metadata, IERC20Permit, IERC165, IERC173, IERC1363, IERC3156FlashLender, IERC5267 {
    //#region Extensions
    using SafeERC20 for IERC20;
    //#endregion

    //#region Constants
    string private constant TOKEN_NAME = "VisualKey Token";
    string private constant TOKEN_SYMBOL = "VKEY";
    string private constant TOKEN_VERSION = "1";
    uint8 private constant TOKEN_DECIMALS = 18;
    uint256 private constant INITIAL_MINT_AMOUNT = 8_388_608 ether;
    uint256 private constant MINT_AMOUNT = 1_048_576 ether;
    uint256 private constant MINT_INTERVAL = 16 days;
    uint256 private constant MINT_WINDOW = 24 hours;
    uint256 private constant MAX_FLASH_LOAN_FEE = 3000;
    bytes32 private constant TYPE_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant MINT_TYPEHASH = keccak256("Mint(address receiver,uint256 nonce,uint256 deadline)");
    bytes32 private constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant SET_FLASH_FEE_TYPEHASH = keccak256("SetFlashFee(address token,uint256 fee,uint256 nonce,uint256 deadline)");
    bytes32 private constant WITHDRAW_ERC20_TYPEHASH = keccak256("WithdrawErc20(address receiver,address token,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private constant WITHDRAW_ERC721_TYPEHASH = keccak256("WithdrawErc721(address receiver,address token,uint256 tokenId,uint256 nonce,uint256 deadline)");
    bytes32 private constant ON_FLASH_LOAN_RETURN_VALUE = keccak256("ERC3156FlashBorrower.onFlashLoan");
    //#endregion

    //#region State
    address private _owner;
    address private _pendingOwner;
    uint256 private _pendingOwnerTimestamp;

    mapping(address account => uint256) private _balances;
    mapping(address account => uint256) private _nonces;
    mapping(address account => mapping(address spender => uint256)) private _allowances;

    uint256 private _flashFee;
    uint256 private _totalSupply;
    uint256 private _lastMintTs;
    bool private _mintDisabled;

    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;
    //#endregion

    //#region Constructor
    constructor(address owner_, address tokensReceiver_, uint256 flashFee_) {
        _owner = owner_;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();

        _setFlashLoanFee(flashFee_);

        _mint(tokensReceiver_, INITIAL_MINT_AMOUNT);
        _lastMintTs = block.timestamp;
    }
    //#endregion

    //#region Public API

    //#region Token Identity
    function name() external pure returns (string memory) {
        return TOKEN_NAME;
    }

    function symbol() external pure returns (string memory) {
        return TOKEN_SYMBOL;
    }
    //#endregion

    //#region Token Metadata
    function decimals() external pure returns (uint8) {
        return TOKEN_DECIMALS;
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }
    //#endregion

    //#region Transfer
    function transfer(address to, uint256 amount) public returns (bool) {
        address owner_ = msg.sender;
        _transfer(owner_, to, amount);
        return true;
    }

    function transferAndCall(address to, uint256 amount) external returns (bool) {
        return transferAndCall(to, amount, "");
    }

    function transferAndCall(address to, uint256 amount, bytes memory data) public returns (bool) {
        if (!transfer(to, amount)) {
            revert ERC1363TransferFailed(to, amount);
        }

        ERC1363Utils.checkOnERC1363TransferReceived(msg.sender, msg.sender, to, amount, data);

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        address spender = msg.sender;
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function transferFromAndCall(address from, address to, uint256 amount) external returns (bool) {
        return transferFromAndCall(from, to, amount, "");
    }

    function transferFromAndCall(
        address from,
        address to,
        uint256 amount,
        bytes memory data
    ) public returns (bool) {
        if (!transferFrom(from, to, amount)) {
            revert ERC1363TransferFromFailed(from, to, amount);
        }

        ERC1363Utils.checkOnERC1363TransferReceived(msg.sender, from, to, amount, data);

        return true;
    }
    //#endregion

    //#region Delegation
    function allowance(address owner_, address spender) public view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        address owner_ = msg.sender;
        _approve(owner_, spender, amount);
        return true;
    }

    function approveAndCall(address spender, uint256 amount) external returns (bool) {
        return approveAndCall(spender, amount, "");
    }

    function approveAndCall(address spender, uint256 amount, bytes memory data) public returns (bool) {
        if (!approve(spender, amount)) {
            revert ERC1363ApproveFailed(spender, amount);
        }

        ERC1363Utils.checkOnERC1363ApprovalReceived(msg.sender, spender, amount, data);

        return true;
    }

    function permit(
        address owner_,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        uint256 nonce = _useNonce(owner_);
        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, amount, nonce, deadline)));
        address signer = ECDSA.recover(hash, v, r, s);

        if (signer != owner_) {
            revert ERC2612InvalidSigner(signer, owner_);
        }

        _approve(owner_, spender, amount);
    }
    //#endregion

    //#region Minting
    function mint(
        address recipient,
        uint256 deadline,
        bytes memory signature
    ) external {
        if (_mintDisabled) {
            revert MintingDisabled();
        }

        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        uint256 earliestNextPossibleMintTs = _lastMintTs + MINT_INTERVAL;

        if (block.timestamp < earliestNextPossibleMintTs) {
            revert MintingNotAllowed(earliestNextPossibleMintTs);
        }

        uint256 numberOfIntervalsElapsed = (block.timestamp - _lastMintTs) / MINT_INTERVAL;
        uint256 currentPeriodStartTs = _lastMintTs + MINT_INTERVAL * numberOfIntervalsElapsed;
        uint256 currentMintWindowEndTs = currentPeriodStartTs + MINT_WINDOW;

        if (block.timestamp > currentMintWindowEndTs) {
            revert MintingWindowMissed(currentMintWindowEndTs);
        }

        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(MINT_TYPEHASH, recipient, _useNonce(_owner), deadline)));
        address signer = ECDSA.recover(hash, signature);

        if (signer != _owner) {
            revert Unauthorized();
        }

        _mint(recipient, MINT_AMOUNT);
        _lastMintTs = block.timestamp;

        emit Minted(recipient, MINT_AMOUNT, block.timestamp);
    }

    function lastMintTimestamp() external view returns (uint256) {
        return _lastMintTs;
    }

    function mintingDisabled() external view returns (bool) {
        return _mintDisabled;
    }

    function disableMinting() external {
        if (msg.sender != _owner) {
            revert Unauthorized();
        }

        _disableMinting();
    }
    //#endregion

    //#region Burning
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
    //#endregion

    //#region Flash loan
    function maxFlashLoan(address token) public view returns (uint256) {
        return token == address(this) ? type(uint256).max - totalSupply() : 0;
    }

    function flashFee(address token, uint256 amount) public view returns (uint256) {
        if (token != address(this)) {
            revert ERC3156UnsupportedToken(token);
        }

        return (amount * _flashFee) / 10_000;
    }

    function setFlashFee(
        address token,
        uint256 fee,
        uint256 deadline,
        bytes memory signature
    ) external {
        if (token != address(this)) {
            revert ERC3156UnsupportedToken(token);
        }

        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        uint256 nonce = _useNonce(_owner);
        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(SET_FLASH_FEE_TYPEHASH, token, fee, nonce, deadline)));
        address signer = ECDSA.recover(hash, signature);

        if (signer != _owner) {
            revert Unauthorized();
        }

        _setFlashLoanFee(fee);

        emit FlashFeeUpdated(fee);
    }

    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        uint256 maxLoan = maxFlashLoan(token);

        if (amount > maxLoan) {
            revert ERC3156ExceededMaxLoan(maxLoan);
        }

        uint256 fee = flashFee(token, amount);

        _mint(address(receiver), amount);

        if (receiver.onFlashLoan(msg.sender, token, amount, fee, data) != ON_FLASH_LOAN_RETURN_VALUE) {
            revert ERC3156InvalidReceiver(address(receiver));
        }

        uint256 burnAmount = amount + fee;

        _spendAllowance(address(receiver), address(this), burnAmount);
        _burn(address(receiver), burnAmount);

        return true;
    }
    //#endregion

    //#region Ownership
    function owner() external view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != _owner) {
            revert Unauthorized();
        }

        if (newOwner == address(0)) {
            _disableMinting();

            delete _owner;
            delete _pendingOwner;
            delete _pendingOwnerTimestamp;

            emit OwnershipTransferred(msg.sender, _owner);
        } else {
            _pendingOwner = newOwner;
            _pendingOwnerTimestamp = block.timestamp;

            emit OwnershipTransferInitiated(_owner, newOwner, block.timestamp);
        }
    }

    function cancelOwnershipTransfer() external {
        if (msg.sender != _owner) {
            revert Unauthorized();
        }

        emit OwnershipTransferCancelled(_owner, _pendingOwner);

        delete _pendingOwner;
        delete _pendingOwnerTimestamp;
    }

    function completeOwnershipTransfer() external {
        if (
            _pendingOwner == address(0) ||
            block.timestamp < _pendingOwnerTimestamp + 16 days
        ) {
            revert Unauthorized();
        }

        address prevOwner = _owner;
        _owner = _pendingOwner;

        delete _pendingOwner;
        delete _pendingOwnerTimestamp;

        emit OwnershipTransferred(prevOwner, _owner);
    }
    //#endregion

    //#region Token Withdrawal
    function withdrawErc20Token(
        address recipient,
        IERC20 token,
        uint256 deadline,
        bytes memory signature
    ) external {
        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(
            WITHDRAW_ERC20_TYPEHASH,
            recipient,
            address(token),
            _useNonce(_owner),
            deadline
        )));

        address signer = ECDSA.recover(hash, signature);

        if (signer != _owner) {
            revert Unauthorized();
        }

        uint256 withdrawAmount = token.balanceOf(address(this));

        token.safeTransfer(recipient, withdrawAmount);

        emit Erc20Withdrawn(recipient, address(token), withdrawAmount);
    }

    function withdrawErc721Token(
        address recipient,
        IERC721 token,
        uint256 tokenId,
        uint256 deadline,
        bytes memory signature
    ) external {
        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(
            WITHDRAW_ERC721_TYPEHASH,
            recipient,
            address(token),
            tokenId,
            _useNonce(_owner),
            deadline
        )));

        address signer = ECDSA.recover(hash, signature);

        if (signer != _owner) {
            revert Unauthorized();
        }

        token.safeTransferFrom(address(this), recipient, tokenId);

        emit Erc721Withdrawn(recipient, address(token), tokenId);
    }
    //#endregion

    //#region Other
    function nonces(address owner_) external view returns (uint256) {
        return _nonces[owner_];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function eip712Domain() external view returns (
        bytes1 fields,
        string memory name_,
        string memory version,
        uint256 chainId,
        address verifyingContract,
        bytes32 salt,
        uint256[] memory extensions
    ) {
        return (
            hex"0f",
            TOKEN_NAME,
            TOKEN_VERSION,
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC20).interfaceId ||
            interfaceId == type(IERC20Burnable).interfaceId ||
            interfaceId == type(IERC20Metadata).interfaceId ||
            interfaceId == type(IERC20Permit).interfaceId ||
            interfaceId == type(IERC165).interfaceId ||
            interfaceId == type(IERC173).interfaceId ||
            interfaceId == type(IERC1363).interfaceId ||
            interfaceId == type(IERC3156FlashLender).interfaceId ||
            interfaceId == type(IERC5267).interfaceId;
    }
    //#endregion

    //#endregion

    //#region Internal API
    function _update(address from, address to, uint256 amount) private {
        if (from == address(0)) {
            _totalSupply += amount;
        } else {
            uint256 fromBalance = _balances[from];

            if (fromBalance < amount) {
                revert ERC20InsufficientBalance(from, fromBalance, amount);
            }

            unchecked {
                _balances[from] = fromBalance - amount;
            }
        }

        if (to == address(0)) {
            unchecked {
                _totalSupply -= amount;
            }
        } else {
            unchecked {
                _balances[to] += amount;
            }
        }

        emit Transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        _update(from, to, amount);
    }

    function _mint(address account, uint256 amount) private {
        if (account == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        _update(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) private {
        if (account == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        _update(account, address(0), amount);
    }

    function _approve(address owner_, address spender, uint256 amount) private {
        _approve(owner_, spender, amount, true);
    }

    function _approve(address owner_, address spender, uint256 amount, bool emitEvent) private {
        if (owner_ == address(0)) {
            revert ERC20InvalidApprover(address(0));
        }

        if (spender == address(0)) {
            revert ERC20InvalidSpender(address(0));
        }

        _allowances[owner_][spender] = amount;

        if (emitEvent) {
            emit Approval(owner_, spender, amount);
        }
    }

    function _spendAllowance(address owner_, address spender, uint256 amount) private {
        uint256 currentAllowance = allowance(owner_, spender);

        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < amount) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, amount);
            }

            unchecked {
                _approve(owner_, spender, currentAllowance - amount, false);
            }
        }
    }

    function _domainSeparatorV4() private view returns (bytes32) {
        if (block.chainid == _cachedChainId) {
            return _cachedDomainSeparator;
        } else {
            return _buildDomainSeparator();
        }
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            TYPE_HASH,
            keccak256(bytes(TOKEN_NAME)),
            keccak256(bytes(TOKEN_VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function _hashTypedDataV4(bytes32 hash) private view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_domainSeparatorV4(), hash);
    }

    function _useNonce(address owner_) private returns (uint256) {
        unchecked {
            return _nonces[owner_]++;
        }
    }

    function _setFlashLoanFee(uint256 fee) private {
        if (fee > MAX_FLASH_LOAN_FEE) {
            revert InvalidFlashLoanFee(fee, MAX_FLASH_LOAN_FEE);
        }

        _flashFee = fee;
    }

    function _disableMinting() private {
        _mintDisabled = true;
        emit MintingCeased(block.timestamp);
    }
    //#endregion

    //#region Events
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Minted(address indexed recipient, uint256 amount, uint256 timestamp);
    event OwnershipTransferInitiated(address indexed from, address indexed to, uint256 timestamp);
    event OwnershipTransferCancelled(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FlashFeeUpdated(uint256 newFee);
    event Erc20Withdrawn(address indexed recipient, address indexed token, uint256 amount);
    event Erc721Withdrawn(address indexed recipient, address indexed token, uint256 tokenId);
    event MintingCeased(uint256 timestamp);
    //#endregion

    //#region Errors
    error Unauthorized();
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address recipient);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidApprover(address approver);
    error ERC20InvalidSpender(address spender);
    error ERC2612ExpiredSignature(uint256 deadline);
    error ERC2612InvalidSigner(address signer, address owner);
    error ERC3156UnsupportedToken(address token);
    error ERC3156ExceededMaxLoan(uint256 maxLoan);
    error ERC3156InvalidReceiver(address recipient);
    error ERC1363TransferFailed(address recipient, uint256 amount);
    error ERC1363TransferFromFailed(address sender, address recipient, uint256 amount);
    error ERC1363ApproveFailed(address spender, uint256 amount);
    error MintingDisabled();
    error MintingNotAllowed(uint256 nextMintPeriodStart);
    error MintingWindowMissed(uint256 mintWindowEnd);
    error InvalidFlashLoanFee(uint256 fee, uint256 maxFee);
    //#endregion
}
