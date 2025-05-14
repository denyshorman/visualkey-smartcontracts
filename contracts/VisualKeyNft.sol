// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC165} from "./interfaces/IERC165.sol";
import {IERC173} from "./interfaces/IERC173.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IERC20Burnable} from "./interfaces/IERC20Burnable.sol";
import {IERC20Permit} from "./interfaces/IERC20Permit.sol";
import {IERC5267} from "./interfaces/IERC5267.sol";
import {IERC721} from "./interfaces/IERC721.sol";
import {IERC721Enumerable} from "./interfaces/IERC721Enumerable.sol";
import {IERC721Metadata} from "./interfaces/IERC721Metadata.sol";
import {IERC721Receiver} from "./interfaces/IERC721Receiver.sol";
import {IERC7572} from "./interfaces/IERC7572.sol";
import {Address} from "./libraries/Address.sol";
import {ECDSA} from "./libraries/ECDSA.sol";
import {MessageHashUtils} from "./libraries/MessageHashUtils.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {Strings} from "./libraries/Strings.sol";

contract VisualKeyNft is IERC165, IERC173, IERC721, IERC721Metadata, IERC721Enumerable, IERC5267, IERC7572 {
    //#region Extensions
    using SafeERC20 for IERC20;
    using Address for address;
    using Strings for uint256;
    //#endregion

    //#region Constants
    string private constant NFT_NAME = "Visual Keys";
    string private constant NFT_SYMBOL = "VKEYNFT";
    string private constant NFT_VERSION = "1";
    bytes4 private constant ERC4906_INTERFACE_ID = 0x49064906;
    bytes32 private constant TYPE_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant MINT_TYPEHASH = keccak256("Mint(address receiver,uint256 paymentAmount,uint256 deadline,uint256 nonce,bytes32 dataHash)");
    //#endregion

    //#region State
    address private _owner;
    address private _pendingOwner;
    uint256 private _pendingOwnerTimestamp;
    string private _contractUri;
    string private _tokenUri;
    address private immutable _paymentToken;

    mapping(uint256 tokenId => address) private _tokenOwners;
    mapping(address owner => uint256) private _ownerBalances;
    mapping(uint256 tokenId => address) private _tokenApprovals;
    mapping(address owner => mapping(address operator => bool)) private _operatorApprovals;
    mapping(address owner => mapping(uint256 index => uint256)) private _ownedTokens;
    mapping(uint256 tokenId => uint256) private _ownedTokensIndex;
    mapping(uint256 tokenId => uint256) private _allTokensIndex;
    mapping(uint256 tokenId => TokenRarity) private _tokenRarity;
    mapping(address => uint256) private _nonces;
    uint256[] private _allTokens;

    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;
    //#endregion

    //#region Constructor
    constructor(
        address owner_,
        string memory contractUri_,
        string memory tokenUri_,
        address paymentToken
    ) {
        if (owner_ == address(0)) {
            revert ERC721InvalidOwner(address(0));
        }

        _owner = owner_;
        _contractUri = contractUri_;
        _tokenUri = tokenUri_;
        _paymentToken = paymentToken;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }
    //#endregion

    //#region Public API

    //#region Token Identity
    function name() external pure returns (string memory) {
        return NFT_NAME;
    }

    function symbol() external pure returns (string memory) {
        return NFT_SYMBOL;
    }
    //#endregion

    //#region Token URI Management
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);

        TokenRarity memory r = _tokenRarity[tokenId];

        return string.concat(
            _tokenUri,
            tokenId.toHexString(20),
            "?level=",
            uint256(r.level).toString(),
            "&power=",
            r.power.toString(),
            "&createdAt=",
            r.createdAt.toString()
        );
    }

    function setTokenURI(string memory tokenUri) public onlyOwner {
        _tokenUri = tokenUri;
        emit TokenURIUpdated();
    }

    function contractURI() external view returns (string memory) {
        return _contractUri;
    }

    function setContractURI(string memory contractUri) public onlyOwner {
        _contractUri = contractUri;
        emit ContractURIUpdated();
    }

    function setContractAndTokenURI(string memory contractUri, string memory tokenUri) external onlyOwner {
        setContractURI(contractUri);
        setTokenURI(tokenUri);
    }
    //#endregion

    //#region Token Information
    function totalSupply() public view returns (uint256) {
        return _allTokens.length;
    }

    function balanceOf(address owner_) public view returns (uint256) {
        if (owner_ == address(0)) {
            revert ERC721InvalidOwner(address(0));
        }

        return _ownerBalances[owner_];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _requireOwned(tokenId);
    }

    function tokenByIndex(uint256 index) external view returns (uint256) {
        if (index >= totalSupply()) {
            revert ERC721OutOfBoundsIndex(address(0), index);
        }

        return _allTokens[index];
    }

    function tokenOfOwnerByIndex(address owner_, uint256 index) external view returns (uint256) {
        if (index >= balanceOf(owner_)) {
            revert ERC721OutOfBoundsIndex(owner_, index);
        }

        return _ownedTokens[owner_][index];
    }

    function rarity(uint256 tokenId) external view returns (TokenRarity memory) {
        if (_ownerOf(tokenId) == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        }

        return _tokenRarity[tokenId];
    }
    //#endregion

    //#region Delegate Approval
    function approve(address to, uint256 tokenId) external {
        _approve(to, tokenId, msg.sender);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _getApproved(tokenId);
    }
    //#endregion

    //#region Operator Approval
    function setApprovalForAll(address operator, bool approved) external {
        _setApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner_, address operator) public view returns (bool) {
        return _operatorApprovals[owner_][operator];
    }
    //#endregion

    //#region Transfer
    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }

        address prevOwner = _update(to, tokenId, msg.sender);

        if (prevOwner != from) {
            revert ERC721IncorrectOwner(from, tokenId, prevOwner);
        }
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _safeTransfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) external {
        _safeTransfer(from, to, tokenId, data);
    }
    //#endregion

    //#region Ownership
    function owner() external view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
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

    function cancelOwnershipTransfer() external onlyOwner {
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

    //#region Minting
    function mint(
        uint256 paymentAmount,
        uint256 deadline,
        bytes memory paymentSignature,
        bytes memory tokenSignature,
        bytes memory data
    ) external {
        //#region Proceed if the paymentAmount is non zero and the transaction is not expired
        if (paymentAmount == 0) {
            revert MintZeroPaymentAmount();
        }

        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }
        //#endregion

        //#region Recover address from signature
        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(
            MINT_TYPEHASH,
            msg.sender,
            paymentAmount,
            deadline,
            _useNonce(msg.sender),
            keccak256(data)
        )));

        address addr = ECDSA.recover(hash, tokenSignature);
        //#endregion

        //#region Check if the address does not have an owner
        uint256 tokenId = uint256(uint160(addr));

        if (_ownerOf(tokenId) != address(0)) {
            revert MintTokenExists(tokenId);
        }
        //#endregion

        //#region Calculate rarity
        TokenRarity memory tokenRarity = TokenRarity({
            level: uint8(_calcLeadingZeroBits(tokenId)),
            power: paymentAmount,
            createdAt: block.timestamp
        });

        _tokenRarity[tokenId] = tokenRarity;
        //#endregion

        //#region Mint token
        _safeMint(msg.sender, tokenId, data);
        //#endregion

        //#region Charge sender and burn payment
        if (paymentSignature.length == 0) {
            _chargeSenderAndBurn(paymentAmount);
        } else {
            _chargeSenderAndBurn(paymentAmount, deadline, paymentSignature);
        }
        //#endregion

        emit NftMinted(msg.sender, tokenId, tokenRarity);
    }
    //#endregion

    //#region Rarity Management
    function increasePower(
        uint256 tokenId,
        uint256 amount
    ) external {
        _increasePower(tokenId, amount);
        _chargeSenderAndBurn(amount);
    }

    function increasePower(
        uint256 tokenId,
        uint256 amount,
        uint256 deadline,
        bytes memory signature
    ) external {
        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        _increasePower(tokenId, amount);
        _chargeSenderAndBurn(amount, deadline, signature);
    }
    //#endregion

    //#region Token Withdrawal
    function withdrawErc20Token(address recipient, IERC20 token) external onlyOwner {
        uint256 withdrawAmount = token.balanceOf(address(this));
        token.safeTransfer(recipient, withdrawAmount);
        emit ERC20Withdrawn(recipient, address(token), withdrawAmount);
    }

    function withdrawErc721Token(address recipient, IERC721 token, uint256 tokenId) external onlyOwner {
        token.safeTransferFrom(address(this), recipient, tokenId);
        emit ERC721Withdrawn(recipient, address(token), tokenId);
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
            NFT_NAME,
            NFT_VERSION,
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC165).interfaceId ||
            interfaceId == type(IERC173).interfaceId ||
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC721Metadata).interfaceId ||
            interfaceId == type(IERC721Enumerable).interfaceId ||
            interfaceId == type(IERC5267).interfaceId ||
            interfaceId == type(IERC7572).interfaceId ||
            interfaceId == ERC4906_INTERFACE_ID;
    }
    //#endregion

    //#endregion

    //#region Private Functions
    function _ownerOf(uint256 tokenId) private view returns (address) {
        return _tokenOwners[tokenId];
    }

    function _getApproved(uint256 tokenId) private view returns (address) {
        return _tokenApprovals[tokenId];
    }

    function _isAuthorized(address owner_, address spender, uint256 tokenId) private view returns (bool) {
        return
            spender != address(0) &&
            (owner_ == spender || isApprovedForAll(owner_, spender) || _getApproved(tokenId) == spender);
    }

    function _checkAuthorized(address owner_, address spender, uint256 tokenId) private view {
        if (!_isAuthorized(owner_, spender, tokenId)) {
            if (owner_ == address(0)) {
                revert ERC721NonexistentToken(tokenId);
            } else {
                revert ERC721InsufficientApproval(spender, tokenId);
            }
        }
    }

    function _update(address to, uint256 tokenId, address auth) private returns (address) {
        address from = _ownerOf(tokenId);

        if (auth != address(0)) {
            _checkAuthorized(from, auth, tokenId);
        }

        if (from != address(0)) {
            _approve(address(0), tokenId, address(0), false);

            unchecked {
                _ownerBalances[from] -= 1;
            }
        }

        if (to != address(0)) {
            unchecked {
                _ownerBalances[to] += 1;
            }
        }

        _tokenOwners[tokenId] = to;

        if (from == address(0)) {
            _addTokenToAllTokensEnumeration(tokenId);
        } else if (from != to) {
            _removeTokenFromOwnerEnumeration(from, tokenId);
        }

        if (to == address(0)) {
            _removeTokenFromAllTokensEnumeration(tokenId);
        } else if (from != to) {
            _addTokenToOwnerEnumeration(to, tokenId);
        }

        emit Transfer(from, to, tokenId);

        return from;
    }

    function _mint(address to, uint256 tokenId) private {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }

        address prevOwner = _update(to, tokenId, address(0));

        if (prevOwner != address(0)) {
            revert ERC721InvalidSender(address(0));
        }
    }

    function _safeMint(address to, uint256 tokenId, bytes memory data) private {
        _mint(to, tokenId);
        _checkOnERC721Received(msg.sender, address(0), to, tokenId, data);
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }

        address prevOwner = _update(to, tokenId, address(0));

        if (prevOwner == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        } else if (prevOwner != from) {
            revert ERC721IncorrectOwner(from, tokenId, prevOwner);
        }
    }

    function _safeTransfer(address from, address to, uint256 tokenId) private {
        _safeTransfer(from, to, tokenId, "");
    }

    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data) private {
        _transfer(from, to, tokenId);
        _checkOnERC721Received(msg.sender, from, to, tokenId, data);
    }

    function _approve(address to, uint256 tokenId, address auth) private {
        _approve(to, tokenId, auth, true);
    }

    function _approve(address to, uint256 tokenId, address auth, bool emitEvent) private {
        if (emitEvent || auth != address(0)) {
            address owner_ = _requireOwned(tokenId);

            if (auth != address(0) && owner_ != auth && !isApprovedForAll(owner_, auth)) {
                revert ERC721InvalidApprover(auth);
            }

            if (emitEvent) {
                emit Approval(owner_, to, tokenId);
            }
        }

        _tokenApprovals[tokenId] = to;
    }

    function _setApprovalForAll(address owner_, address operator, bool approved) private {
        if (operator == address(0)) {
            revert ERC721InvalidOperator(operator);
        }

        _operatorApprovals[owner_][operator] = approved;

        emit ApprovalForAll(owner_, operator, approved);
    }

    function _requireOwned(uint256 tokenId) private view returns (address) {
        address owner_ = _ownerOf(tokenId);

        if (owner_ == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        }

        return owner_;
    }

    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) private {
        uint256 length = balanceOf(to) - 1;
        _ownedTokens[to][length] = tokenId;
        _ownedTokensIndex[tokenId] = length;
    }

    function _addTokenToAllTokensEnumeration(uint256 tokenId) private {
        _allTokensIndex[tokenId] = _allTokens.length;
        _allTokens.push(tokenId);
    }

    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId) private {
        uint256 lastTokenIndex = balanceOf(from);
        uint256 tokenIndex = _ownedTokensIndex[tokenId];

        mapping(uint256 index => uint256) storage _ownedTokensByOwner = _ownedTokens[from];

        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId = _ownedTokensByOwner[lastTokenIndex];

            _ownedTokensByOwner[tokenIndex] = lastTokenId;
            _ownedTokensIndex[lastTokenId] = tokenIndex;
        }

        delete _ownedTokensIndex[tokenId];
        delete _ownedTokensByOwner[lastTokenIndex];
    }

    function _removeTokenFromAllTokensEnumeration(uint256 tokenId) private {
        uint256 lastTokenIndex = _allTokens.length - 1;
        uint256 tokenIndex = _allTokensIndex[tokenId];

        uint256 lastTokenId = _allTokens[lastTokenIndex];

        _allTokens[tokenIndex] = lastTokenId;
        _allTokensIndex[lastTokenId] = tokenIndex;

        delete _allTokensIndex[tokenId];
        _allTokens.pop();
    }

    function _checkOnERC721Received(
        address operator,
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) private {
        if (to.isContract()) {
            try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (bytes4 retval) {
                if (retval != IERC721Receiver.onERC721Received.selector) {
                    revert ERC721InvalidReceiver(to);
                }
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert ERC721InvalidReceiver(to);
                } else {
                    assembly ("memory-safe") {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        }
    }

    function _calcLeadingZeroBits(uint256 x) private pure returns (uint256 r) {
        assembly ("memory-safe") {
            x := shl(96, x)
            r := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
            r := or(r, shl(6, lt(0xffffffffffffffff, shr(r, x))))
            r := or(r, shl(5, lt(0xffffffff, shr(r, x))))
            r := or(r, shl(4, lt(0xffff, shr(r, x))))
            r := or(r, shl(3, lt(0xff, shr(r, x))))
            r := add(xor(r, byte(and(0x1f, shr(shr(r, x), 0x8421084210842108cc6318c6db6d54be)),
                0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff)), iszero(x))
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
            keccak256(bytes(NFT_NAME)),
            keccak256(bytes(NFT_VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function _hashTypedDataV4(bytes32 hash) private view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_domainSeparatorV4(), hash);
    }

    function _useNonce(address addr) private returns (uint256) {
        unchecked {
            return _nonces[addr]++;
        }
    }

    function _increasePower(uint256 tokenId, uint256 amount) private {
        if (amount == 0) {
            revert PowerZeroIncrease();
        }

        TokenRarity storage tokenRarity = _tokenRarity[tokenId];

        uint256 power = tokenRarity.power;

        if (power == 0) {
            revert ERC721NonexistentToken(tokenId);
        }

        uint256 newPower = power + amount;

        tokenRarity.power = newPower;

        emit MetadataUpdate(tokenId);
        emit NftPowerIncreased(tokenId, newPower, amount);
    }

    function _chargeSenderAndBurn(uint256 amount) private {
        IERC20Burnable(_paymentToken).transferFrom(msg.sender, address(this), amount);
        IERC20Burnable(_paymentToken).burn(amount);
    }

    function _chargeSenderAndBurn(uint256 amount, uint256 deadline, bytes memory signature) private {
        (bytes32 r, bytes32 s, uint8 v) = ECDSA.splitSignature(signature);
        IERC20Permit(_paymentToken).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _chargeSenderAndBurn(amount);
    }
    //#endregion

    //#region Modifiers
    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert Unauthorized();
        }
        _;
    }
    //#endregion

    //#region Structs
    struct TokenRarity {
        uint8 level;
        uint256 power;
        uint256 createdAt;
    }
    //#endregion

    //#region Events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed delegate, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event ERC20Withdrawn(address indexed recipient, address indexed token, uint256 amount);
    event ERC721Withdrawn(address indexed recipient, address indexed token, uint256 tokenId);
    event OwnershipTransferInitiated(address indexed from, address indexed to, uint256 timestamp);
    event OwnershipTransferCancelled(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event NftPowerIncreased(uint256 indexed tokenId, uint256 newPower, uint256 amount);
    event NftMinted(address indexed recipient, uint256 tokenId, TokenRarity rarity);
    event MetadataUpdate(uint256 tokenId);
    event TokenURIUpdated();
    event ContractURIUpdated();
    //#endregion

    //#region Errors
    error Unauthorized();
    error ERC721InvalidOwner(address owner);
    error ERC721NonexistentToken(uint256 tokenId);
    error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner);
    error ERC721InvalidSender(address sender);
    error ERC721InvalidReceiver(address receiver);
    error ERC721InsufficientApproval(address operator, uint256 tokenId);
    error ERC721InvalidApprover(address approver);
    error ERC721InvalidOperator(address operator);
    error ERC721OutOfBoundsIndex(address owner, uint256 index);
    error ERC2612ExpiredSignature(uint256 deadline);
    error MintZeroPaymentAmount();
    error MintTokenExists(uint256 tokenId);
    error PowerZeroIncrease();
    //#endregion
}
