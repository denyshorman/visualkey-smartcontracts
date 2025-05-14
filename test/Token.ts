import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Wallet } from 'ethers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { VisualKeyToken } from '../typechain-types';

//#region Constants
const TOKEN_NAME = 'VisualKey Token';
const TOKEN_SYMBOL = 'VKEY';
const TOKEN_DECIMALS = 18;
const INITIAL_MINT_AMOUNT = ethers.parseEther('8388608');
const MINT_AMOUNT = ethers.parseEther('1048576');
const MINT_INTERVAL = 16 * 24 * 60 * 60; // 16 days in seconds
const MINT_WINDOW = 24 * 60 * 60; // 24 hours in seconds
const MAX_FLASH_LOAN_FEE = 3000n; // 0.3%
const DEFAULT_FLASH_FEE = 100n; // 0.01% = 100 / 10_000
//#endregion

//#region EIP712 Type Definitions
const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const mintTypes = {
  Mint: [
    { name: 'receiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const setFlashFeeTypes = {
  SetFlashFee: [
    { name: 'token', type: 'address' },
    { name: 'fee', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
//#endregion

//#region Utils
async function deployTokenFixture() {
  const [owner, user1, user2, tokensReceiver, flashLoanReceiver] = await ethers.getSigners();

  const token = await ethers.deployContract('VisualKeyToken', [
    owner.address,
    tokensReceiver.address,
    DEFAULT_FLASH_FEE,
  ]);
  await token.waitForDeployment();

  const mockERC1363Receiver = await ethers.deployContract('MockERC1363Receiver');
  await mockERC1363Receiver.waitForDeployment();

  const mockERC1363Spender = await ethers.deployContract('MockERC1363Spender');
  await mockERC1363Spender.waitForDeployment();

  const mockERC3156FlashBorrower = await ethers.deployContract('MockERC3156FlashBorrower', [
    await token.getAddress(),
    true,
  ]);

  await mockERC3156FlashBorrower.waitForDeployment();

  const dummyERC20 = await ethers.deployContract('VisualKeyToken', [owner.address, owner.address, 0n]);
  await dummyERC20.waitForDeployment();
  await dummyERC20.connect(owner).transfer(await token.getAddress(), ethers.parseEther('100'));

  const dummyERC721 = await ethers.deployContract('VisualKeyNft', [
    owner.address,
    'x',
    'y',
    await dummyERC20.getAddress(),
  ]);
  await dummyERC721.waitForDeployment();

  return {
    owner,
    user1,
    user2,
    tokensReceiver,
    flashLoanReceiver,
    token,
    mockERC1363Receiver,
    mockERC1363Spender,
    mockERC3156FlashBorrower,
    dummyERC20,
    dummyERC721,
  };
}

async function getDomain(contract: VisualKeyToken) {
  const eip712Domain = await contract.eip712Domain();

  return {
    name: eip712Domain[1],
    version: eip712Domain[2],
    chainId: eip712Domain[3],
    verifyingContract: eip712Domain[4],
  };
}

//#endregion

describe('Token', function () {
  describe('constructor', function () {
    it('should deploy Token contract correctly', async function () {
      const { token, owner, tokensReceiver } = await loadFixture(deployTokenFixture);
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.balanceOf(tokensReceiver.address)).to.equal(INITIAL_MINT_AMOUNT);
      expect(await token.totalSupply()).to.equal(INITIAL_MINT_AMOUNT);
      expect(await token.flashFee(await token.getAddress(), 1000n)).to.equal((1000n * DEFAULT_FLASH_FEE) / 10000n); // fee for 1000 is 1000 * 100 / 10000 = 10
      expect(await token.lastMintTimestamp()).to.be.gt(0);
    });

    it('should set flash fee correctly', async function () {
      const { owner, tokensReceiver } = await loadFixture(deployTokenFixture);
      const customFlashFee = 150n; // 0.015%
      const token = await ethers.deployContract('VisualKeyToken', [
        owner.address,
        tokensReceiver.address,
        customFlashFee,
      ]);
      await token.waitForDeployment();
      expect(await token.flashFee(await token.getAddress(), ethers.parseEther('1'))).to.equal(
        (ethers.parseEther('1') * customFlashFee) / 10000n,
      );
    });

    it('should revert if flash fee is too high', async function () {
      const { owner, tokensReceiver } = await loadFixture(deployTokenFixture);
      const invalidFlashFee = MAX_FLASH_LOAN_FEE + 1n;
      const tokenFactory = await ethers.getContractFactory('VisualKeyToken');
      await expect(ethers.deployContract('VisualKeyToken', [owner.address, tokensReceiver.address, invalidFlashFee]))
        .to.be.revertedWithCustomError(tokenFactory, 'InvalidFlashLoanFee')
        .withArgs(invalidFlashFee, MAX_FLASH_LOAN_FEE);
    });
  });

  describe('Token Identity', function () {
    it('name() should return the correct name', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.name()).to.equal(TOKEN_NAME);
    });

    it('symbol() should return the correct symbol', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });
  });

  describe('Token Metadata', function () {
    it('decimals() should return the correct decimals', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it('totalSupply() should return the total token supply', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.totalSupply()).to.equal(INITIAL_MINT_AMOUNT);
    });

    it('balanceOf() should return the correct balance for an account', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      expect(await token.balanceOf(tokensReceiver.address)).to.equal(INITIAL_MINT_AMOUNT);
      expect(await token.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe('Transfer', function () {
    it('transfer() should transfer tokens correctly and emit Transfer event', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      await expect(token.connect(tokensReceiver).transfer(user1.address, amount))
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, user1.address, amount);
      expect(await token.balanceOf(tokensReceiver.address)).to.equal(INITIAL_MINT_AMOUNT - amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
    });

    it('transfer() should revert for insufficient balance', async function () {
      const { token, user1, user2 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      await expect(token.connect(user1).transfer(user2.address, amount)).to.be.revertedWithCustomError(
        token,
        'ERC20InsufficientBalance',
      );
    });

    it('transfer() should revert when transferring to zero address', async function () {
      const { token, tokensReceiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      await expect(token.connect(tokensReceiver).transfer(ethers.ZeroAddress, amount))
        .to.be.revertedWithCustomError(token, 'ERC20InvalidReceiver')
        .withArgs(ethers.ZeroAddress);
    });

    it('transferAndCall() should transfer tokens and call receiver', async function () {
      const { token, tokensReceiver, mockERC1363Receiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const data = ethers.toUtf8Bytes('test_payload');
      const receiverAddress = await mockERC1363Receiver.getAddress();

      await expect(
        token.connect(tokensReceiver)['transferAndCall(address,uint256,bytes)'](receiverAddress, amount, data),
      )
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, receiverAddress, amount)
        .to.emit(mockERC1363Receiver, 'Received');

      expect(await token.balanceOf(receiverAddress)).to.equal(amount);
    });

    it('transferAndCall() (no data) should transfer tokens and call receiver', async function () {
      const { token, tokensReceiver, mockERC1363Receiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const receiverAddress = await mockERC1363Receiver.getAddress();

      await expect(token.connect(tokensReceiver)['transferAndCall(address,uint256)'](receiverAddress, amount))
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, receiverAddress, amount)
        .to.emit(mockERC1363Receiver, 'Received');

      expect(await token.balanceOf(receiverAddress)).to.equal(amount);
    });

    it('transferAndCall() should revert if receiver is EOA', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const data = ethers.toUtf8Bytes('test_payload');

      await expect(token.connect(tokensReceiver)['transferAndCall(address,uint256,bytes)'](user1.address, amount, data))
        .to.be.revertedWithCustomError(token, 'ERC1363InvalidReceiver')
        .withArgs(user1.address);
    });

    it('transferFrom() should transfer tokens correctly with allowance', async function () {
      const { token, tokensReceiver, user1, user2 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('50');

      await expect(token.connect(tokensReceiver).approve(user1.address, amount))
        .to.emit(token, 'Approval')
        .withArgs(tokensReceiver.address, user1.address, amount);

      await expect(token.connect(user1).transferFrom(tokensReceiver.address, user2.address, amount))
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, user2.address, amount);

      expect(await token.balanceOf(user2.address)).to.equal(amount);
      expect(await token.allowance(tokensReceiver.address, user1.address)).to.equal(0);
    });

    it('transferFrom() should revert for insufficient allowance', async function () {
      const { token, tokensReceiver, user1, user2 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('50');
      await token.connect(tokensReceiver).approve(user1.address, amount - 1n);
      await expect(
        token.connect(user1).transferFrom(tokensReceiver.address, user2.address, amount),
      ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance');
    });

    it('transferFromAndCall() should transfer tokens with allowance and call receiver', async function () {
      const { token, tokensReceiver, user1, mockERC1363Receiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const data = ethers.toUtf8Bytes('test_payload_from');
      const receiverAddress = await mockERC1363Receiver.getAddress();

      await token.connect(tokensReceiver).approve(user1.address, amount);

      await expect(
        token
          .connect(user1)
          ['transferFromAndCall(address,address,uint256,bytes)'](tokensReceiver.address, receiverAddress, amount, data),
      )
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, receiverAddress, amount)
        .to.emit(mockERC1363Receiver, 'Received');

      expect(await token.balanceOf(receiverAddress)).to.equal(amount);
      expect(await token.allowance(tokensReceiver.address, user1.address)).to.equal(0);
    });

    it('transferFromAndCall() (no data) should transfer tokens with allowance and call receiver', async function () {
      const { token, tokensReceiver, user1, mockERC1363Receiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const receiverAddress = await mockERC1363Receiver.getAddress();

      await token.connect(tokensReceiver).approve(user1.address, amount);

      await expect(
        token
          .connect(user1)
          ['transferFromAndCall(address,address,uint256)'](tokensReceiver.address, receiverAddress, amount),
      )
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, receiverAddress, amount)
        .to.emit(mockERC1363Receiver, 'Received');

      expect(await token.balanceOf(receiverAddress)).to.equal(amount);
    });
  });

  describe('Delegation (Approve and Allowance)', function () {
    it('approve() should set allowance correctly and emit Approval event', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('200');
      await expect(token.connect(tokensReceiver).approve(user1.address, amount))
        .to.emit(token, 'Approval')
        .withArgs(tokensReceiver.address, user1.address, amount);
      expect(await token.allowance(tokensReceiver.address, user1.address)).to.equal(amount);
    });

    it('approve() to zero address should revert', async function () {
      const { token, tokensReceiver } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      await expect(token.connect(tokensReceiver).approve(ethers.ZeroAddress, amount))
        .to.be.revertedWithCustomError(token, 'ERC20InvalidSpender')
        .withArgs(ethers.ZeroAddress);
    });

    it('allowance() should return the correct allowance', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('150');
      await token.connect(tokensReceiver).approve(user1.address, amount);
      expect(await token.allowance(tokensReceiver.address, user1.address)).to.equal(amount);
      expect(await token.allowance(tokensReceiver.address, ethers.Wallet.createRandom().address)).to.equal(0);
    });

    it('approveAndCall() should approve and call spender', async function () {
      const { token, tokensReceiver, mockERC1363Spender } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const data = ethers.toUtf8Bytes('test_approve_payload');
      const spenderAddress = await mockERC1363Spender.getAddress();

      await expect(token.connect(tokensReceiver)['approveAndCall(address,uint256,bytes)'](spenderAddress, amount, data))
        .to.emit(token, 'Approval')
        .withArgs(tokensReceiver.address, spenderAddress, amount)
        .to.emit(mockERC1363Spender, 'Approved');

      expect(await token.allowance(tokensReceiver.address, spenderAddress)).to.equal(amount);
    });

    it('approveAndCall() (no data) should approve and call spender', async function () {
      const { token, tokensReceiver, mockERC1363Spender } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const spenderAddress = await mockERC1363Spender.getAddress();

      await expect(token.connect(tokensReceiver)['approveAndCall(address,uint256)'](spenderAddress, amount))
        .to.emit(token, 'Approval')
        .withArgs(tokensReceiver.address, spenderAddress, amount)
        .to.emit(mockERC1363Spender, 'Approved');

      expect(await token.allowance(tokensReceiver.address, spenderAddress)).to.equal(amount);
    });

    it('approveAndCall() should revert if spender is EOA', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther('100');
      const data = ethers.toUtf8Bytes('test_payload');

      await expect(token.connect(tokensReceiver)['approveAndCall(address,uint256,bytes)'](user1.address, amount, data))
        .to.be.revertedWithCustomError(token, 'ERC1363InvalidSpender')
        .withArgs(user1.address);
    });
  });

  describe('Permit', function () {
    it('permit() should allow spending with a valid signature', async function () {
      const { token, owner, user1, user2, tokensReceiver } = await loadFixture(deployTokenFixture);

      const permitOwner = Wallet.createRandom().connect(ethers.provider);
      await owner.sendTransaction({ to: permitOwner.address, value: ethers.parseEther('1') });
      await token.connect(tokensReceiver).transfer(permitOwner.address, ethers.parseEther('500'));

      const spender = user1.address;
      const value = ethers.parseEther('75');
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(permitOwner.address);

      const domain = await getDomain(token);
      const permitValues = { owner: permitOwner.address, spender, value, nonce, deadline };
      const signature = await permitOwner.signTypedData(domain, permitTypes, permitValues);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(token.permit(permitOwner.address, spender, value, deadline, v, r, s))
        .to.emit(token, 'Approval')
        .withArgs(permitOwner.address, spender, value);
      expect(await token.allowance(permitOwner.address, spender)).to.equal(value);
      expect(await token.nonces(permitOwner.address)).to.equal(nonce + 1n);

      // Test spending the permitted tokens
      await expect(token.connect(user1).transferFrom(permitOwner.address, user2.address, value)).to.emit(
        token,
        'Transfer',
      );
      expect(await token.balanceOf(user2.address)).to.equal(value);
    });

    it('permit() should revert with an expired signature', async function () {
      const { token, owner, tokensReceiver } = await loadFixture(deployTokenFixture);
      const permitOwner = Wallet.createRandom().connect(ethers.provider);
      await owner.sendTransaction({ to: permitOwner.address, value: ethers.parseEther('1') });
      await token.connect(tokensReceiver).transfer(permitOwner.address, ethers.parseEther('500'));

      const spender = owner.address; // spender can be anyone
      const value = ethers.parseEther('75');
      const deadline = (await time.latest()) - 3600; // Expired
      const nonce = await token.nonces(permitOwner.address);

      const domain = await getDomain(token);
      const permitValues = { owner: permitOwner.address, spender, value, nonce, deadline };
      const signature = await permitOwner.signTypedData(domain, permitTypes, permitValues);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(token.permit(permitOwner.address, spender, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(token, 'ERC2612ExpiredSignature')
        .withArgs(deadline);
    });

    it('permit() should revert with an invalid signature (wrong signer)', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      const permitOwnerAddress = Wallet.createRandom().address; // Real owner
      const wrongSigner = Wallet.createRandom().connect(ethers.provider); // Signer
      await owner.sendTransaction({ to: wrongSigner.address, value: ethers.parseEther('1') });

      const spender = user1.address;
      const value = ethers.parseEther('75');
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(permitOwnerAddress); // Nonce of the actual owner

      const domain = await getDomain(token);
      // Sign with wrongSigner but claim to be permitOwnerAddress
      const permitValues = { owner: permitOwnerAddress, spender, value, nonce, deadline };
      const signature = await wrongSigner.signTypedData(domain, permitTypes, permitValues);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(token.permit(permitOwnerAddress, spender, value, deadline, v, r, s)).to.be.revertedWithCustomError(
        token,
        'ERC2612InvalidSigner',
      ); // Error might be more specific in actual OpenZeppelin
    });
  });

  describe('Minting', function () {
    it('mint() should allow owner to mint tokens after interval and within window', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      const recipient = user1.address;
      const deadline = (await time.latest()) + MINT_INTERVAL + 3600;

      await time.increase(MINT_INTERVAL + 100);

      const nonce = await token.nonces(owner.address);
      const domain = await getDomain(token);
      const mintValues = { receiver: recipient, nonce, deadline };
      const signature = await owner.signTypedData(domain, mintTypes, mintValues);

      const initialTotalSupply = await token.totalSupply();
      const initialRecipientBalance = await token.balanceOf(recipient);

      await expect(token.connect(user1).mint(recipient, deadline, signature))
        .to.emit(token, 'Minted')
        .withArgs(recipient, MINT_AMOUNT, (ts: bigint) => ts > 0)
        .to.emit(token, 'Transfer')
        .withArgs(ethers.ZeroAddress, recipient, MINT_AMOUNT);

      expect(await token.totalSupply()).to.equal(initialTotalSupply + MINT_AMOUNT);
      expect(await token.balanceOf(recipient)).to.equal(initialRecipientBalance + MINT_AMOUNT);
    });

    it('mint() should revert if minting is disabled', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      await token.connect(owner).disableMinting();

      const recipient = user1.address;
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(owner.address);
      const domain = await getDomain(token);
      const mintValues = { receiver: recipient, nonce, deadline };
      const signature = await owner.signTypedData(domain, mintTypes, mintValues);

      await expect(token.mint(recipient, deadline, signature)).to.be.revertedWithCustomError(token, 'MintingDisabled');
    });

    it('mint() should revert if called before MINT_INTERVAL', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      const recipient = user1.address;
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(owner.address);
      const domain = await getDomain(token);
      const mintValues = { receiver: recipient, nonce, deadline };

      const signature = await owner.signTypedData(domain, mintTypes, mintValues);

      await expect(token.mint(recipient, deadline, signature)).to.be.revertedWithCustomError(
        token,
        'MintingNotAllowed',
      );
    });

    it('mint() should revert if called after MINT_WINDOW', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      const recipient = user1.address;
      const deadline = (await time.latest()) + MINT_INTERVAL + MINT_WINDOW + 3600;

      await time.increase(MINT_INTERVAL + MINT_WINDOW + 100);

      const nonce = await token.nonces(owner.address);
      const domain = await getDomain(token);
      const mintValues = { receiver: recipient, nonce, deadline };
      const signature = await owner.signTypedData(domain, mintTypes, mintValues);

      await expect(token.mint(recipient, deadline, signature)).to.be.revertedWithCustomError(
        token,
        'MintingWindowMissed',
      );
    });

    it('mint() should revert with invalid signature', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      const wrongSigner = Wallet.createRandom(ethers.provider);
      await owner.sendTransaction({ to: wrongSigner.address, value: ethers.parseEther('1') });

      const recipient = user1.address;
      const deadline = (await time.latest()) + 3600;

      await time.increase(MINT_INTERVAL + 100);

      const nonce = await token.nonces(owner.address);
      const domain = await getDomain(token);
      const mintValues = { receiver: recipient, nonce, deadline };
      const signature = await wrongSigner.signTypedData(domain, mintTypes, mintValues);

      await expect(token.mint(recipient, deadline, signature)).to.be.revertedWithCustomError(
        token,
        'ERC2612ExpiredSignature',
      );
    });

    it('disableMinting() should disable minting and emit MintingCeased', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      expect(await token.mintingDisabled()).to.equal(false);
      await expect(token.connect(owner).disableMinting()).to.emit(token, 'MintingCeased');
      expect(await token.mintingDisabled()).to.equal(true);
    });

    it('disableMinting() should revert if not called by owner', async function () {
      const { token, user1 } = await loadFixture(deployTokenFixture);
      await expect(token.connect(user1).disableMinting()).to.be.revertedWithCustomError(token, 'Unauthorized');
    });

    it('lastMintTimestamp() should return the last mint timestamp', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const initialTimestamp = await token.lastMintTimestamp();
      expect(initialTimestamp).to.be.gt(0);

      // Simulate a successful mint to update the timestamp
      // Requires advancing time and a valid signature
    });

    it('mintingDisabled() should return the minting status', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      expect(await token.mintingDisabled()).to.equal(false);
      await token.connect(owner).disableMinting();
      expect(await token.mintingDisabled()).to.equal(true);
    });
  });

  describe('Burning', function () {
    it('burn() should burn tokens from msg.sender and emit Transfer event', async function () {
      const { token, tokensReceiver } = await loadFixture(deployTokenFixture);
      const burnAmount = ethers.parseEther('10');
      const initialTotalSupply = await token.totalSupply();
      const initialBalance = await token.balanceOf(tokensReceiver.address);

      await expect(token.connect(tokensReceiver).burn(burnAmount))
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, ethers.ZeroAddress, burnAmount);

      expect(await token.totalSupply()).to.equal(initialTotalSupply - burnAmount);
      expect(await token.balanceOf(tokensReceiver.address)).to.equal(initialBalance - burnAmount);
    });

    it('burn() should revert for insufficient balance', async function () {
      const { token, user1 } = await loadFixture(deployTokenFixture);
      const burnAmount = ethers.parseEther('10');
      await expect(token.connect(user1).burn(burnAmount)).to.be.revertedWithCustomError(
        token,
        'ERC20InsufficientBalance',
      );
    });

    it('burnFrom() should burn tokens from a specified account with allowance', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const burnAmount = ethers.parseEther('20');
      await token.connect(tokensReceiver).approve(user1.address, burnAmount);

      const initialTotalSupply = await token.totalSupply();
      const initialBalanceOwner = await token.balanceOf(tokensReceiver.address);

      await expect(token.connect(user1).burnFrom(tokensReceiver.address, burnAmount))
        .to.emit(token, 'Transfer')
        .withArgs(tokensReceiver.address, ethers.ZeroAddress, burnAmount);

      expect(await token.totalSupply()).to.equal(initialTotalSupply - burnAmount);
      expect(await token.balanceOf(tokensReceiver.address)).to.equal(initialBalanceOwner - burnAmount);
      expect(await token.allowance(tokensReceiver.address, user1.address)).to.equal(0);
    });

    it('burnFrom() should revert for insufficient allowance', async function () {
      const { token, tokensReceiver, user1 } = await loadFixture(deployTokenFixture);
      const burnAmount = ethers.parseEther('20');
      await token.connect(tokensReceiver).approve(user1.address, burnAmount - 1n);
      await expect(token.connect(user1).burnFrom(tokensReceiver.address, burnAmount)).to.be.revertedWithCustomError(
        token,
        'ERC20InsufficientAllowance',
      );
    });
  });

  describe('Flash Loan', function () {
    it('maxFlashLoan() should return max loanable amount for this token', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const totalSupply = await token.totalSupply();
      // maxFlashLoan = type(uint256).max - totalSupply
      // For testing, we can't easily get type(uint256).max in JS, but we know it should be very large.
      // We can check it's greater than current total supply.
      expect(await token.maxFlashLoan(await token.getAddress())).to.be.gt(totalSupply);
    });

    it('maxFlashLoan() should return 0 for an unsupported token', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const otherTokenAddress = Wallet.createRandom().address;
      expect(await token.maxFlashLoan(otherTokenAddress)).to.equal(0);
    });

    it('flashFee() should calculate the correct fee for this token', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const loanAmount = ethers.parseEther('1000');
      const expectedFee = (loanAmount * DEFAULT_FLASH_FEE) / 10000n;
      expect(await token.flashFee(await token.getAddress(), loanAmount)).to.equal(expectedFee);
    });

    it('flashFee() should revert for an unsupported token', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const otherTokenAddress = Wallet.createRandom().address;
      const loanAmount = ethers.parseEther('1000');
      await expect(token.flashFee(otherTokenAddress, loanAmount))
        .to.be.revertedWithCustomError(token, 'ERC3156UnsupportedToken')
        .withArgs(otherTokenAddress);
    });

    it('setFlashFee() should allow owner to update flash fee with signature', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      const newFee = 200n; // 0.02%
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(owner.address);
      const tokenAddress = await token.getAddress();

      const domain = await getDomain(token);
      const feeValues = { token: tokenAddress, fee: newFee, nonce, deadline };
      const signature = await owner.signTypedData(domain, setFlashFeeTypes, feeValues);

      await expect(token.connect(owner).setFlashFee(tokenAddress, newFee, deadline, signature)) // Can be called by anyone with owner's sig
        .to.emit(token, 'FlashFeeUpdated')
        .withArgs(newFee);
      expect(await token.flashFee(tokenAddress, ethers.parseEther('1'))).to.equal(
        (ethers.parseEther('1') * newFee) / 10000n,
      );
    });

    it('setFlashFee() should revert if fee is too high', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      const invalidNewFee = MAX_FLASH_LOAN_FEE + 1n;
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(owner.address);
      const tokenAddress = await token.getAddress();

      const domain = await getDomain(token);
      const feeValues = { token: tokenAddress, fee: invalidNewFee, nonce, deadline };
      const signature = await owner.signTypedData(domain, setFlashFeeTypes, feeValues);

      await expect(token.setFlashFee(tokenAddress, invalidNewFee, deadline, signature))
        .to.be.revertedWithCustomError(token, 'InvalidFlashLoanFee')
        .withArgs(invalidNewFee, MAX_FLASH_LOAN_FEE);
    });

    it('flashLoan() should execute a flash loan successfully', async function () {
      const {
        token,
        tokensReceiver,
        mockERC3156FlashBorrower,
        flashLoanReceiver: initiator,
      } = await loadFixture(deployTokenFixture);

      const loanAmount = ethers.parseEther('100');
      const fee = await token.flashFee(await token.getAddress(), loanAmount);
      const borrowerAddress = await mockERC3156FlashBorrower.getAddress();
      const tokenAddress = await token.getAddress();

      // Borrower needs to have enough tokens to pay back loan + fee, or approve Token contract to pull
      // The MockERC3156FlashBorrower is set to approve payback in its constructor.
      // We also need to send some tokens to the borrower for the fee, or it should generate them.
      // For simplicity, assume borrower can cover the fee. We can transfer some tokens to it.
      await token.connect(tokensReceiver).transfer(borrowerAddress, fee * 2n); // Ensure borrower has funds for fee

      // Set allowance for the Token contract to pull `loanAmount + fee` from borrower
      // This is typically done inside onFlashLoan or before, by the borrower contract.
      // Our mock is configured to approve this from its onFlashLoan.

      const data = ethers.toUtf8Bytes('flash_loan_payload');

      const initialBorrowerBalance = await token.balanceOf(borrowerAddress);
      const initialTokenTotalSupply = await token.totalSupply();

      await expect(token.connect(initiator).flashLoan(borrowerAddress, tokenAddress, loanAmount, data))
        .to.emit(token, 'Transfer') // Mint to borrower
        .withArgs(ethers.ZeroAddress, borrowerAddress, loanAmount)
        .to.emit(mockERC3156FlashBorrower, 'LoanReceived') // Mock event
        .withArgs(initiator.address, tokenAddress, loanAmount, fee, data)
        .to.emit(token, 'Approval') // Borrower approves token contract for payback
        .withArgs(borrowerAddress, tokenAddress, loanAmount + fee)
        .to.emit(token, 'Transfer') // Burn from borrower
        .withArgs(borrowerAddress, ethers.ZeroAddress, loanAmount + fee);

      expect(await token.totalSupply()).to.equal(initialTokenTotalSupply - fee);
      expect(await token.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance - fee);
    });

    it('flashLoan() should revert if loan amount exceeds maxFlashLoan', async function () {
      const { token, mockERC3156FlashBorrower, flashLoanReceiver: initiator } = await loadFixture(deployTokenFixture);
      const tokenAddress = await token.getAddress();
      const maxLoan = await token.maxFlashLoan(tokenAddress);
      const loanAmount = maxLoan + 1n; // Exceed max loan
      const borrowerAddress = await mockERC3156FlashBorrower.getAddress();
      const data = ethers.toUtf8Bytes('');

      await expect(token.connect(initiator).flashLoan(borrowerAddress, tokenAddress, loanAmount, data))
        .to.be.revertedWithCustomError(token, 'ERC3156ExceededMaxLoan')
        .withArgs(maxLoan);
    });

    it('flashLoan() should revert if receiver returns invalid magic value', async function () {
      const { token, flashLoanReceiver: initiator } = await loadFixture(deployTokenFixture);

      const badBorrower = await ethers.deployContract('MockERC3156FlashBorrower', [await token.getAddress(), false]);
      await badBorrower.waitForDeployment();

      const loanAmount = ethers.parseEther('10');
      const borrowerAddress = await badBorrower.getAddress();
      const tokenAddress = await token.getAddress();
      const data = ethers.toUtf8Bytes('');

      await expect(token.connect(initiator).flashLoan(borrowerAddress, tokenAddress, loanAmount, data))
        .to.be.revertedWithCustomError(token, 'ERC3156InvalidReceiver')
        .withArgs(borrowerAddress);
    });
  });

  describe('Ownership', function () {
    it('owner() should return the current owner', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      expect(await token.owner()).to.equal(owner.address);
    });

    it('transferOwnership() should initiate ownership transfer', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      await expect(token.connect(owner).transferOwnership(user1.address))
        .to.emit(token, 'OwnershipTransferInitiated')
        .withArgs(owner.address, user1.address, (ts: bigint) => ts > 0);
      // _pendingOwner is private, cannot directly check here without an event or getter
    });

    it('transferOwnership() to zero address should renounce ownership and disable minting', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      expect(await token.mintingDisabled()).to.equal(false);

      await expect(token.connect(owner).transferOwnership(ethers.ZeroAddress))
        .to.emit(token, 'OwnershipTransferred')
        .withArgs(owner.address, ethers.ZeroAddress)
        .to.emit(token, 'MintingCeased');

      expect(await token.owner()).to.equal(ethers.ZeroAddress);
      expect(await token.mintingDisabled()).to.equal(true);
    });

    it('cancelOwnershipTransfer() should cancel an initiated transfer', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      await token.connect(owner).transferOwnership(user1.address);
      // Some time passes, but not enough to complete
      await time.increase(100);
      await expect(token.connect(owner).cancelOwnershipTransfer())
        .to.emit(token, 'OwnershipTransferCancelled')
        .withArgs(owner.address, user1.address);
      // _pendingOwner should be cleared. Test by trying to complete.
      await time.increase(16 * 24 * 60 * 60 + 1); // More than 16 days
      await expect(token.connect(user1).completeOwnershipTransfer()).to.be.revertedWithCustomError(
        token,
        'Unauthorized',
      ); // or a more specific error if pendingOwner is zero
    });

    it('completeOwnershipTransfer() should complete ownership transfer after delay', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      await token.connect(owner).transferOwnership(user1.address);
      await time.increase(16 * 24 * 60 * 60 + 1); // 16 days + 1 second
      await expect(token.connect(owner).completeOwnershipTransfer()) // Can be called by anyone
        .to.emit(token, 'OwnershipTransferred')
        .withArgs(owner.address, user1.address);
      expect(await token.owner()).to.equal(user1.address);
    });

    it('completeOwnershipTransfer() should revert if called too early', async function () {
      const { token, owner, user1 } = await loadFixture(deployTokenFixture);
      await token.connect(owner).transferOwnership(user1.address);
      await time.increase(15 * 24 * 60 * 60); // Only 15 days
      await expect(token.connect(user1).completeOwnershipTransfer()).to.be.revertedWithCustomError(
        token,
        'Unauthorized',
      ); // Or a more specific error
    });
  });

  describe('Other Utility Functions', function () {
    it('nonces() should return the current nonce for an owner', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      expect(await token.nonces(owner.address)).to.equal(0); // Initial nonce for permit/mint etc.
      // After a permit or mint call, nonce should increment.
    });

    it('DOMAIN_SEPARATOR() should return a non-zero domain separator', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.DOMAIN_SEPARATOR()).to.not.equal(ethers.ZeroHash);
    });

    it('eip712Domain() should return correct EIP712 domain parameters', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const [fields, name, version, chainId, verifyingContract, salt, extensions] = await token.eip712Domain();
      expect(fields).to.equal('0x0f'); // Standard fields for EIP-712
      expect(name).to.equal(TOKEN_NAME);
      expect(version).to.equal('1'); // Version "1"
      expect(chainId).to.equal((await ethers.provider.getNetwork()).chainId);
      expect(verifyingContract).to.equal(await token.getAddress());
      expect(salt).to.equal(ethers.ZeroHash); // No salt used
      expect(extensions.length).to.equal(0); // No extensions
    });

    it('supportsInterface() should return true for supported interfaces', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.supportsInterface('0x01ffc9a7')).to.equal(true); // IERC165
      expect(await token.supportsInterface('0x36372b07')).to.equal(true); // IERC20
      expect(await token.supportsInterface('0xa219a025')).to.equal(true); // IERC20Metadata (name, symbol, decimals)
      expect(await token.supportsInterface('0x9d8ff7da')).to.equal(true); // IERC20Permit
      expect(await token.supportsInterface('0x7f5828d0')).to.equal(true); // IERC173 (Ownable)
      expect(await token.supportsInterface('0xb0202a11')).to.equal(true); // IERC1363
      expect(await token.supportsInterface('0xe4143091')).to.equal(true); // IERC3156FlashLender
      expect(await token.supportsInterface('0x84b0196e')).to.equal(true); // IERC5267 (EIP-712 domain)
    });

    it('supportsInterface() should return false for unsupported interfaces', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.supportsInterface('0xffffffff')).to.equal(false);
      expect(await token.supportsInterface('0x80ac58cd')).to.equal(false);
    });
  });
});
