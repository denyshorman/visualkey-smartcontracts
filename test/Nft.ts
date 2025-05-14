import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HDNodeWallet } from 'ethers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { VisualKeyToken, VisualKeyNft } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

//#region Constants
const NFT_NAME = 'Visual Keys';
const NFT_SYMBOL = 'VKEYNFT';
const DEFAULT_CONTRACT_URI = 'https://exmaple.com/api/nft';
const DEFAULT_TOKEN_URI = 'https://exmaple.com/api/nft/tokens/';

const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const mintNftTypes = {
  Mint: [
    { name: 'receiver', type: 'address' },
    { name: 'paymentAmount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'dataHash', type: 'bytes32' },
  ],
};
//#endregion

//#region Utils
async function deployNftFixture() {
  const [owner, user1, user2] = await ethers.getSigners();

  const token = await ethers.deployContract('VisualKeyToken', [owner.address, owner.address, 0n]);
  await token.waitForDeployment();

  const nft = await ethers.deployContract('VisualKeyNft', [
    owner.address,
    DEFAULT_CONTRACT_URI,
    DEFAULT_TOKEN_URI,
    await token.getAddress(),
  ]);

  await nft.waitForDeployment();

  await token.connect(owner).transfer(user1.address, ethers.parseEther('1000'));
  await token.connect(owner).transfer(user2.address, ethers.parseEther('1000'));
  await owner.sendTransaction({ to: user1.address, value: ethers.parseEther('1') });
  await owner.sendTransaction({ to: user2.address, value: ethers.parseEther('1') });

  return { owner, user1, user2, token, nft };
}

async function mint(
  ownerSigner: HardhatEthersSigner,
  nftRecipientWallet: HDNodeWallet,
  paymentTokenContract: VisualKeyToken,
  nftContract: VisualKeyNft,
  tokenIdentityPrivateKey: string,
  paymentAmount: bigint,
) {
  if ((await ethers.provider.getBalance(nftRecipientWallet.address)) < ethers.parseEther('0.1')) {
    await ownerSigner.sendTransaction({ to: nftRecipientWallet.address, value: ethers.parseEther('0.5') });
  }

  if ((await paymentTokenContract.balanceOf(nftRecipientWallet.address)) < paymentAmount) {
    await paymentTokenContract.connect(ownerSigner).transfer(nftRecipientWallet.address, paymentAmount * 2n);
  }

  const deadline = (await time.latest()) + 3600;
  const data = '0x';

  //#region Allow NFT contract to spend user tokens
  const eip712TokenDomain = await paymentTokenContract.eip712Domain();
  const recipientPermitNonce = await paymentTokenContract.nonces(nftRecipientWallet.address);

  const tokenDomain = {
    name: eip712TokenDomain[1],
    version: eip712TokenDomain[2],
    chainId: eip712TokenDomain[3],
    verifyingContract: eip712TokenDomain[4],
  };

  const permitValues = {
    owner: nftRecipientWallet.address,
    spender: await nftContract.getAddress(),
    value: paymentAmount,
    nonce: recipientPermitNonce,
    deadline: deadline,
  };

  const paymentSignature = await nftRecipientWallet.signTypedData(tokenDomain, permitTypes, permitValues);
  //#endregion

  //#region Private key ownership signature proof
  const eip712NftDomain = await nftContract.eip712Domain();
  const recipientMintNonce = await nftContract.nonces(nftRecipientWallet.address);

  const nftDomain = {
    name: eip712NftDomain[1],
    version: eip712NftDomain[2],
    chainId: eip712NftDomain[3],
    verifyingContract: eip712NftDomain[4],
  };

  const mintValues = {
    receiver: nftRecipientWallet.address,
    paymentAmount: paymentAmount,
    deadline: deadline,
    nonce: recipientMintNonce,
    dataHash: ethers.keccak256(data),
  };

  const tokenIdentitySigner = new ethers.Wallet(tokenIdentityPrivateKey, ethers.provider);
  const tokenSignature = await tokenIdentitySigner.signTypedData(nftDomain, mintNftTypes, mintValues);
  //#endregion

  const tx = await nftContract
    .connect(nftRecipientWallet)
    .mint(paymentAmount, deadline, paymentSignature, tokenSignature, data);

  await tx.wait();

  return tx;
}

function leadingZeros(token: bigint): number {
  let mask = 1n << 159n;
  let count = 0;

  while (mask > 0n) {
    if ((token & mask) !== 0n) {
      break;
    }
    count++;
    mask >>= 1n;
  }

  return count;
}
//#endregion

describe('Nft', function () {
  describe('constructor', function () {
    it('should deploy NFT contract correctly', async function () {
      await expect(loadFixture(deployNftFixture)).to.not.be.rejected;
    });

    it('should fail to deploy Nft with zero address owner', async function () {
      const nftFactory = await ethers.getContractFactory('VisualKeyNft');
      const nft = ethers.deployContract('VisualKeyNft', [ethers.ZeroAddress, '', '', ethers.ZeroAddress]);
      await expect(nft).to.be.revertedWithCustomError(nftFactory, 'ERC721InvalidOwner').withArgs(ethers.ZeroAddress);
    });
  });

  describe('name', function () {
    it('should return the correct name', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const name = await nft.name();
      expect(name).to.equal(NFT_NAME);
    });
  });

  describe('symbol', function () {
    it('should return the correct symbol', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const symbol = await nft.symbol();
      expect(symbol).to.equal(NFT_SYMBOL);
    });
  });

  describe('tokenURI', function () {
    it('should return correct token uri', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const paymentAmount = ethers.parseUnits('1', 18);

      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, paymentAmount);
      const tokenId = BigInt(tokenIdentityWallet.address);

      const level = leadingZeros(tokenId);
      const rarity = await nft.rarity(tokenId);
      const uri = await nft.tokenURI(tokenId);

      const expectedUri = `${DEFAULT_TOKEN_URI}${tokenIdentityWallet.address.toLowerCase()}?level=${level}&power=${rarity.power}&createdAt=${rarity.createdAt}`;

      expect(uri).to.equal(expectedUri);
    });

    it('should fail if token does not exist', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nonExistentTokenId = BigInt(ethers.Wallet.createRandom().address);
      await expect(nft.tokenURI(nonExistentTokenId))
        .to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken')
        .withArgs(nonExistentTokenId);
    });
  });

  describe('setTokenURI', function () {
    it('should change the base token URI by owner', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const newBaseTokenURI = 'https://new.example.com/api/nft/';
      await nft.connect(owner).setTokenURI(newBaseTokenURI);

      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const paymentAmount = ethers.parseUnits('1', 18);
      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, paymentAmount);
      const tokenId = BigInt(tokenIdentityWallet.address);

      const rarity = await nft.rarity(tokenId);
      const uri = await nft.tokenURI(tokenId);
      const expectedUri = `${newBaseTokenURI}${tokenIdentityWallet.address.toLowerCase()}?level=${rarity.level}&power=${rarity.power}&createdAt=${rarity.createdAt}`;
      expect(uri).to.equal(expectedUri);
    });

    it('should fail if not called by the owner', async function () {
      const { user1, nft } = await loadFixture(deployNftFixture);
      const newBaseTokenURI = 'https://new.example.com/api/nft/';
      await expect(nft.connect(user1).setTokenURI(newBaseTokenURI)).to.be.revertedWithCustomError(nft, 'Unauthorized');
    });
  });

  describe('contractURI', function () {
    it('should return the correct contract URI', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const contractUri = await nft.contractURI();
      expect(contractUri).to.equal(DEFAULT_CONTRACT_URI);
    });
  });

  describe('setContractURI', function () {
    it('should set contract URI', async function () {
      const { owner, nft } = await loadFixture(deployNftFixture);
      const newContractUri = 'https://new.example.com/api/contract';
      await expect(nft.connect(owner).setContractURI(newContractUri)).to.emit(nft, 'ContractURIUpdated');
      expect(await nft.contractURI()).to.equal(newContractUri);
    });

    it('should fail if not called by the owner', async function () {
      const { user1, nft } = await loadFixture(deployNftFixture);
      const newContractUri = 'https://new.example.com/api/contract';
      await expect(nft.connect(user1).setContractURI(newContractUri)).to.be.revertedWithCustomError(
        nft,
        'Unauthorized',
      );
    });
  });

  describe('setContractAndTokenURI', function () {
    it('should set both contract and token URI', async function () {
      const { owner, nft } = await loadFixture(deployNftFixture);
      const newContractUri = 'https://new.example.com/api/contract';
      const newTokenUri = 'https://new.example.com/api/nft/tokens/';

      await expect(nft.connect(owner).setContractAndTokenURI(newContractUri, newTokenUri))
        .to.emit(nft, 'ContractURIUpdated')
        .to.emit(nft, 'TokenURIUpdated');
    });

    it('should fail if not called by the owner', async function () {
      const { user1, nft } = await loadFixture(deployNftFixture);
      const newContractUri = 'https://new.example.com/api/contract';
      const newTokenUri = 'https://new.example.com/api/nft/tokens/';
      await expect(
        nft.connect(user1).setContractAndTokenURI(newContractUri, newTokenUri),
      ).to.be.revertedWithCustomError(nft, 'Unauthorized');
    });
  });

  describe('totalSupply', async function () {
    it('should return the expected total supply', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      expect(await nft.totalSupply()).to.equal(0);

      const recipient1 = ethers.Wallet.createRandom(ethers.provider);
      const identity1 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, recipient1, token, nft, identity1.privateKey, 1n);
      expect(await nft.totalSupply()).to.equal(1);

      const recipient2 = ethers.Wallet.createRandom(ethers.provider);
      const identity2 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, recipient2, token, nft, identity2.privateKey, 1n);
      expect(await nft.totalSupply()).to.equal(2);

      const tokenId1 = BigInt(identity1.address);
      const transferToWallet = ethers.Wallet.createRandom(ethers.provider);
      await nft.connect(recipient1).transferFrom(recipient1.address, transferToWallet.address, tokenId1);
      expect(await nft.totalSupply()).to.equal(2);
    });
  });

  describe('balanceOf', async function () {
    it('should return the expected balance', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);

      expect(await nft.balanceOf(nftRecipientWallet.address)).to.equal(0);

      const identity1 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, nftRecipientWallet, token, nft, identity1.privateKey, 1n);
      expect(await nft.balanceOf(nftRecipientWallet.address)).to.equal(1);

      const identity2 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, nftRecipientWallet, token, nft, identity2.privateKey, 1n);
      expect(await nft.balanceOf(nftRecipientWallet.address)).to.equal(2);
    });

    it('should fail with ERC721InvalidOwner for zero address', async function () {
      const { nft } = await loadFixture(deployNftFixture);

      await expect(nft.balanceOf(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(nft, 'ERC721InvalidOwner')
        .withArgs(ethers.ZeroAddress);
    });
  });

  describe('ownerOf', async function () {
    it('should return the expected owner', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, 1n);

      expect(await nft.ownerOf(tokenId)).to.equal(nftRecipientWallet.address);
    });

    it('should fail with ERC721NonexistentToken if token does not exist', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const tokenId = BigInt(ethers.Wallet.createRandom().address);
      await expect(nft.ownerOf(tokenId)).to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken').withArgs(tokenId);
    });
  });

  describe('tokenByIndex', function () {
    it('should return the expected token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokensMintedIdentities: HDNodeWallet[] = [];

      const identity1 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, nftRecipientWallet, token, nft, identity1.privateKey, 1n);
      tokensMintedIdentities.push(identity1);

      const identity2 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, nftRecipientWallet, token, nft, identity2.privateKey, 1n);
      tokensMintedIdentities.push(identity2);

      expect(await nft.tokenByIndex(0)).to.equal(BigInt(tokensMintedIdentities[0].address));
      expect(await nft.tokenByIndex(1)).to.equal(BigInt(tokensMintedIdentities[1].address));
    });

    it('should fail with ERC721OutOfBoundsIndex if index is out of bounds', async function () {
      const { nft } = await loadFixture(deployNftFixture);

      await expect(nft.tokenByIndex(0))
        .to.be.revertedWithCustomError(nft, 'ERC721OutOfBoundsIndex')
        .withArgs(ethers.ZeroAddress, 0);
    });
  });

  describe('tokenOfOwnerByIndex', function () {
    it('should return the expected token for an owner', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const recipient1 = ethers.Wallet.createRandom(ethers.provider);
      const recipient2 = ethers.Wallet.createRandom(ethers.provider);

      const recipient1Tokens: HDNodeWallet[] = [];

      const identity1 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, recipient1, token, nft, identity1.privateKey, 1n);
      recipient1Tokens.push(identity1);

      const identity2 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, recipient2, token, nft, identity2.privateKey, 1n);

      const identity3 = ethers.Wallet.createRandom(ethers.provider);
      await mint(owner, recipient1, token, nft, identity3.privateKey, 1n);
      recipient1Tokens.push(identity3);

      expect(await nft.tokenOfOwnerByIndex(recipient1.address, 0)).to.equal(BigInt(recipient1Tokens[0].address));
      expect(await nft.tokenOfOwnerByIndex(recipient1.address, 1)).to.equal(BigInt(recipient1Tokens[1].address));
    });

    it('should fail with ERC721InvalidOwner for zero address', async function () {
      const { nft } = await loadFixture(deployNftFixture);

      await expect(nft.tokenOfOwnerByIndex(ethers.ZeroAddress, 0))
        .to.be.revertedWithCustomError(nft, 'ERC721InvalidOwner')
        .withArgs(ethers.ZeroAddress);
    });

    it('should fail with ERC721OutOfBoundsIndex if index is out of bounds for owner', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const someOwnerAddress = ethers.Wallet.createRandom(ethers.provider).address;

      await expect(nft.tokenOfOwnerByIndex(someOwnerAddress, 0))
        .to.be.revertedWithCustomError(nft, 'ERC721OutOfBoundsIndex')
        .withArgs(someOwnerAddress, 0);
    });
  });

  describe('rarity', function () {
    it('should return correct rarity for an existing token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const paymentAmount = ethers.parseUnits('5', 18);

      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, paymentAmount);
      const tokenId = BigInt(tokenIdentityWallet.address);

      const expectedLevel = leadingZeros(tokenId);
      const rarityData = await nft.rarity(tokenId);

      expect(rarityData.level).to.equal(expectedLevel);
      expect(rarityData.power).to.equal(paymentAmount);
      expect(rarityData.createdAt).to.be.gt(0);
    });

    it('should revert if token does not exist', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nonExistentTokenId = BigInt(ethers.Wallet.createRandom().address);
      await expect(nft.rarity(nonExistentTokenId))
        .to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken')
        .withArgs(nonExistentTokenId);
    });
  });

  describe('approve', function () {
    it('should allow owner to approve a spender for a token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const spenderWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await expect(nft.connect(nftOwnerWallet).approve(spenderWallet.address, tokenId))
        .to.emit(nft, 'Approval')
        .withArgs(nftOwnerWallet.address, spenderWallet.address, tokenId);
      expect(await nft.getApproved(tokenId)).to.equal(spenderWallet.address);
    });

    it('should allow approved operator to approve a spender for a token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const operatorWallet = ethers.Wallet.createRandom(ethers.provider);
      const spenderWallet = ethers.Wallet.createRandom(ethers.provider);

      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await owner.sendTransaction({ to: nftOwnerWallet.address, value: ethers.parseEther('0.01') });
      await owner.sendTransaction({ to: operatorWallet.address, value: ethers.parseEther('0.01') });

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await nft.connect(nftOwnerWallet).setApprovalForAll(operatorWallet.address, true);

      await expect(nft.connect(operatorWallet).approve(spenderWallet.address, tokenId))
        .to.emit(nft, 'Approval')
        .withArgs(nftOwnerWallet.address, spenderWallet.address, tokenId);

      expect(await nft.getApproved(tokenId)).to.equal(spenderWallet.address);
    });

    it('should revert if approver is not owner or approved for all', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const attackerWallet = ethers.Wallet.createRandom(ethers.provider);
      const spenderWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await expect(nft.connect(attackerWallet).approve(spenderWallet.address, tokenId))
        .to.be.revertedWithCustomError(nft, 'ERC721InvalidApprover')
        .withArgs(attackerWallet.address);
    });
  });

  describe('getApproved', function () {
    it('should return the approved address for a token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const spenderWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await nft.connect(nftOwnerWallet).approve(spenderWallet.address, tokenId);
      expect(await nft.getApproved(tokenId)).to.equal(spenderWallet.address);
    });

    it('should revert if token does not exist', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nonExistentTokenId = BigInt(ethers.Wallet.createRandom().address);

      await expect(nft.getApproved(nonExistentTokenId))
        .to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken')
        .withArgs(nonExistentTokenId);
    });
  });

  describe('setApprovalForAll', function () {
    it('should allow owner to set approval for all for an operator', async function () {
      const { nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const operatorWallet = ethers.Wallet.createRandom(ethers.provider);

      const { owner: fixtureOwner } = await loadFixture(deployNftFixture);
      await fixtureOwner.sendTransaction({ to: nftOwnerWallet.address, value: ethers.parseEther('0.1') });

      await expect(nft.connect(nftOwnerWallet).setApprovalForAll(operatorWallet.address, true))
        .to.emit(nft, 'ApprovalForAll')
        .withArgs(nftOwnerWallet.address, operatorWallet.address, true);

      expect(await nft.isApprovedForAll(nftOwnerWallet.address, operatorWallet.address)).to.be.equal(true);
    });
  });

  describe('isApprovedForAll', function () {
    it('should return true if operator is approved for all by owner', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const operatorWallet = ethers.Wallet.createRandom(ethers.provider);

      const { owner: fixtureOwner } = await loadFixture(deployNftFixture);
      await fixtureOwner.sendTransaction({ to: nftOwnerWallet.address, value: ethers.parseEther('0.1') });

      await nft.connect(nftOwnerWallet).setApprovalForAll(operatorWallet.address, true);

      expect(await nft.isApprovedForAll(nftOwnerWallet.address, operatorWallet.address)).to.be.equal(true);
    });
  });

  describe('transferFrom', function () {
    it('should allow owner to transfer token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const recipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await expect(nft.connect(nftOwnerWallet).transferFrom(nftOwnerWallet.address, recipientWallet.address, tokenId))
        .to.emit(nft, 'Transfer')
        .withArgs(nftOwnerWallet.address, recipientWallet.address, tokenId);

      expect(await nft.ownerOf(tokenId)).to.equal(recipientWallet.address);
    });
  });

  describe('safeTransferFrom', function () {
    it('should allow owner to safeTransfer token to EOA', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      const nftOwnerWallet = ethers.Wallet.createRandom(ethers.provider);
      const recipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);

      await mint(owner, nftOwnerWallet, token, nft, tokenIdentityWallet.privateKey, 1n);
      const tokenId = BigInt(tokenIdentityWallet.address);

      await expect(
        nft
          .connect(nftOwnerWallet)
          ['safeTransferFrom(address,address,uint256)'](nftOwnerWallet.address, recipientWallet.address, tokenId),
      )
        .to.emit(nft, 'Transfer')
        .withArgs(nftOwnerWallet.address, recipientWallet.address, tokenId);

      expect(await nft.ownerOf(tokenId)).to.equal(recipientWallet.address);
    });
  });

  describe('owner', function () {
    it('should return the correct contract owner', async function () {
      const { owner, nft } = await loadFixture(deployNftFixture);
      expect(await nft.owner()).to.equal(owner.address);
    });
  });

  describe('transferOwnership', function () {
    it('should allow current owner to initiate ownership transfer', async function () {
      const { owner, user1, nft } = await loadFixture(deployNftFixture);
      await expect(nft.connect(owner).transferOwnership(user1.address))
        .to.emit(nft, 'OwnershipTransferInitiated')
        .withArgs(owner.address, user1.address, (timestamp: bigint) => timestamp > 0);
    });
  });

  describe('cancelOwnershipTransfer', function () {
    it('should allow current owner to cancel an initiated ownership transfer', async function () {
      const { owner, user1, nft } = await loadFixture(deployNftFixture);
      await nft.connect(owner).transferOwnership(user1.address);

      await expect(nft.connect(owner).cancelOwnershipTransfer())
        .to.emit(nft, 'OwnershipTransferCancelled')
        .withArgs(owner.address, user1.address);
    });
  });

  describe('completeOwnershipTransfer', function () {
    it('should allow anyone to complete ownership transfer after delay', async function () {
      const { owner, user1, nft } = await loadFixture(deployNftFixture);
      const newOwnerWallet = ethers.Wallet.createRandom(ethers.provider);

      await nft.connect(owner).transferOwnership(newOwnerWallet.address);
      await time.increase(16 * 24 * 60 * 60 + 1);

      await owner.sendTransaction({ to: newOwnerWallet.address, value: ethers.parseEther('0.1') });

      await expect(nft.connect(user1).completeOwnershipTransfer())
        .to.emit(nft, 'OwnershipTransferred')
        .withArgs(owner.address, newOwnerWallet.address);

      expect(await nft.owner()).to.equal(newOwnerWallet.address);
    });
  });

  describe('mint', function () {
    it('should mint successfully with permit', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      //#region Random user arrives
      const user = ethers.Wallet.createRandom(ethers.provider);
      //#endregion

      //#region User receives some tokens
      const tokenAmount = 10n;
      await token.connect(owner).transfer(user.address, tokenAmount);
      await owner.sendTransaction({ to: user.address, value: ethers.parseEther('0.5') });
      //#endregion

      //#region User decided to mint this address
      const privateKey = '0x27755950ea5b8c37ac67ac94c1aabed1bea9df230cb6282c676d76f3866e54a3';
      const address = '0x05742C213f106A3455351B678Bfc553AA16c5Fb2';
      const tokenId = ethers.getBigInt(address);
      const level = 5n;
      //#endregion

      //#region User mints
      const paymentAmount = tokenAmount;
      const deadline = (await time.latest()) + 3600;
      const data = '0x';

      //#region Allow NFT contract to spend user tokens
      const eip712TokenDomain = await token.eip712Domain();
      const userPermitNonce = await token.nonces(user);

      const tokenDomain = {
        name: eip712TokenDomain[1],
        version: eip712TokenDomain[2],
        chainId: eip712TokenDomain[3],
        verifyingContract: eip712TokenDomain[4],
      };

      const permitValues = {
        owner: user.address,
        spender: nft.target,
        value: paymentAmount,
        nonce: userPermitNonce,
        deadline: deadline,
      };

      const paymentSignature = await user.signTypedData(tokenDomain, permitTypes, permitValues);
      //#endregion

      //#region Proof that the user knows a private key of the address they want to mint
      const eip712NftDomain = await nft.eip712Domain();
      const userMintNonce = await nft.nonces(user);

      const nftDomain = {
        name: eip712NftDomain[1],
        version: eip712NftDomain[2],
        chainId: eip712NftDomain[3],
        verifyingContract: eip712NftDomain[4],
      };

      const mintValues = {
        receiver: user.address,
        paymentAmount: paymentAmount,
        deadline: deadline,
        nonce: userMintNonce,
        dataHash: ethers.keccak256(data),
      };

      const privateKeySigner = new ethers.Wallet(privateKey, ethers.provider);
      const tokenSignature = await privateKeySigner.signTypedData(nftDomain, mintNftTypes, mintValues);
      //#endregion

      const mintTx = nft.connect(user).mint(paymentAmount, deadline, paymentSignature, tokenSignature, data);

      await expect(mintTx)
        .to.emit(nft, 'NftMinted')
        .withArgs(user.address, tokenId, (rarity: VisualKeyNft.TokenRarityStruct) => {
          expect(rarity.level).to.equal(level);
          expect(rarity.power).to.equal(paymentAmount);
          expect(rarity.createdAt).to.be.gt(0);
          return true;
        });

      expect(await nft.ownerOf(tokenId)).to.equal(user.address);
      //#endregion
    });

    it('should mint successfully with allowance', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);

      //#region Random user arrives
      const user = ethers.Wallet.createRandom(ethers.provider);
      //#endregion

      //#region User receives some tokens
      const tokenAmount = 10n;
      await token.connect(owner).transfer(user.address, tokenAmount);
      await owner.sendTransaction({ to: user.address, value: ethers.parseEther('0.5') });
      //#endregion

      //#region User approves spending in advance
      await token.connect(user).approve(nft.target, tokenAmount);
      //#endregion

      //#region User decided to mint this address
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      //#endregion

      //#region User mints
      const deadline = (await time.latest()) + 3600;
      const data = '0xffaabbcc';

      //#region Proof that the user knows a private key of the address they want to mint
      const eip712NftDomain = await nft.eip712Domain();
      const userMintNonce = await nft.nonces(user);

      const nftDomain = {
        name: eip712NftDomain[1],
        version: eip712NftDomain[2],
        chainId: eip712NftDomain[3],
        verifyingContract: eip712NftDomain[4],
      };

      const mintValues = {
        receiver: user.address,
        paymentAmount: tokenAmount,
        deadline: deadline,
        nonce: userMintNonce,
        dataHash: ethers.keccak256(data),
      };

      const tokenSignature = await tokenIdentityWallet.signTypedData(nftDomain, mintNftTypes, mintValues);
      //#endregion

      const mintTx = nft.connect(user).mint(tokenAmount, deadline, '0x', tokenSignature, data);

      await expect(mintTx)
        .to.emit(nft, 'NftMinted')
        .withArgs(user.address, tokenIdentityWallet.address, (rarity: VisualKeyNft.TokenRarityStruct) => {
          expect(rarity.level).to.equal(leadingZeros(BigInt(tokenIdentityWallet.address)));
          expect(rarity.power).to.equal(tokenAmount);
          expect(rarity.createdAt).to.be.gt(0);
          return true;
        });

      expect(await nft.ownerOf(tokenIdentityWallet.address)).to.equal(user.address);
      //#endregion
    });
  });

  describe('increasePower', function () {
    it('should increase power of a token', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const initialPower = 100n;

      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, initialPower);
      const tokenId = BigInt(tokenIdentityWallet.address);

      const additionalPower = 200n;
      const totalPower = initialPower + additionalPower;

      const prevRarity = await nft.rarity(tokenId);
      expect(prevRarity.level).to.equal(leadingZeros(tokenId));
      expect(prevRarity.power).to.equal(initialPower);
      expect(prevRarity.createdAt).to.be.gt(0);

      await token.connect(owner).transfer(nftRecipientWallet.address, additionalPower);
      await token.connect(nftRecipientWallet).approve(nft.target, additionalPower);

      await expect(nft.connect(nftRecipientWallet)['increasePower(uint256,uint256)'](tokenId, additionalPower))
        .to.emit(nft, 'NftPowerIncreased')
        .withArgs(tokenId, totalPower, additionalPower);

      const currRarity = await nft.rarity(tokenId);
      expect(currRarity.level).to.equal(prevRarity.level);
      expect(currRarity.power).to.equal(totalPower);
      expect(currRarity.createdAt).to.equal(prevRarity.createdAt);
    });

    it('should increase power of a token with permit', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const nftRecipientWallet = ethers.Wallet.createRandom(ethers.provider);
      const tokenIdentityWallet = ethers.Wallet.createRandom(ethers.provider);
      const initialPower = 100n;

      await mint(owner, nftRecipientWallet, token, nft, tokenIdentityWallet.privateKey, initialPower);
      const tokenId = BigInt(tokenIdentityWallet.address);

      const additionalPower = 300n;
      const totalPower = initialPower + additionalPower;

      const prevRarity = await nft.rarity(tokenId);
      expect(prevRarity.level).to.equal(leadingZeros(tokenId));
      expect(prevRarity.power).to.equal(initialPower);
      expect(prevRarity.createdAt).to.be.gt(0);

      const deadline = (await time.latest()) + 3600;

      //#region Allow NFT contract to spend user tokens
      const eip712TokenDomain = await token.eip712Domain();
      const recipientPermitNonce = await token.nonces(nftRecipientWallet.address);

      const tokenDomain = {
        name: eip712TokenDomain[1],
        version: eip712TokenDomain[2],
        chainId: eip712TokenDomain[3],
        verifyingContract: eip712TokenDomain[4],
      };

      const permitValues = {
        owner: nftRecipientWallet.address,
        spender: nft.target,
        value: additionalPower,
        nonce: recipientPermitNonce,
        deadline: deadline,
      };

      const paymentSignature = await nftRecipientWallet.signTypedData(tokenDomain, permitTypes, permitValues);
      //#endregion

      await token.connect(owner).transfer(nftRecipientWallet.address, additionalPower);

      await expect(
        nft
          .connect(nftRecipientWallet)
          ['increasePower(uint256,uint256,uint256,bytes)'](tokenId, additionalPower, deadline, paymentSignature),
      )
        .to.emit(nft, 'NftPowerIncreased')
        .withArgs(tokenId, totalPower, additionalPower);

      const currRarity = await nft.rarity(tokenId);
      expect(currRarity.level).to.equal(prevRarity.level);
      expect(currRarity.power).to.equal(totalPower);
      expect(currRarity.createdAt).to.equal(prevRarity.createdAt);
    });

    it('should revert if the token does not exist', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nonExistentTokenId = 1n;
      const amount = 1n;

      await expect(nft['increasePower(uint256,uint256)'](nonExistentTokenId, amount))
        .to.be.revertedWithCustomError(nft, 'ERC721NonexistentToken')
        .withArgs(nonExistentTokenId);
    });

    it('should revert if amount is zero', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const nonExistentTokenId = 1n;
      const amount = 0n;

      await expect(nft['increasePower(uint256,uint256)'](nonExistentTokenId, amount)).to.be.revertedWithCustomError(
        nft,
        'PowerZeroIncrease',
      );
    });
  });

  describe('withdrawErc20Token', function () {
    it('should allow owner to withdraw ERC20 tokens sent to the contract', async function () {
      const { owner, token, nft } = await loadFixture(deployNftFixture);
      const amountToSend = ethers.parseUnits('10', 18);
      const nftContractAddress = await nft.getAddress();

      await token.connect(owner).transfer(nftContractAddress, amountToSend);
      const ownerInitialBalance = await token.balanceOf(owner.address);

      await expect(nft.connect(owner).withdrawErc20Token(owner.address, await token.getAddress()))
        .to.emit(nft, 'ERC20Withdrawn')
        .withArgs(owner.address, await token.getAddress(), amountToSend);

      expect(await token.balanceOf(owner.address)).to.equal(ownerInitialBalance + amountToSend);
    });
  });

  describe('nonces', function () {
    it('should return 0 for a new user', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const someWallet = ethers.Wallet.createRandom(ethers.provider);
      expect(await nft.nonces(someWallet.address)).to.equal(0);
    });
  });

  describe('DOMAIN_SEPARATOR', function () {
    it('should return a non-zero domain separator', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      expect(await nft.DOMAIN_SEPARATOR()).to.not.equal(ethers.ZeroHash);
    });
  });

  describe('eip712Domain', function () {
    it('should return correct EIP712 domain parameters', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      const [fields, name, version, chainId, verifyingContract, salt] = await nft.eip712Domain();
      expect(fields).to.equal('0x0f');
      expect(name).to.equal(NFT_NAME);
      expect(version).to.equal('1');
      expect(chainId).to.equal((await ethers.provider.getNetwork()).chainId);
      expect(verifyingContract).to.equal(await nft.getAddress());
      expect(salt).to.equal(ethers.ZeroHash);
    });
  });

  describe('supportsInterface', function () {
    it('should return true for supported interfaces', async function () {
      const { nft } = await loadFixture(deployNftFixture);
      expect(await nft.supportsInterface('0x01ffc9a7')).to.equal(true); // ERC165
      expect(await nft.supportsInterface('0x7f5828d0')).to.equal(true); // ERC173
      expect(await nft.supportsInterface('0x80ac58cd')).to.equal(true); // ERC721
      expect(await nft.supportsInterface('0x5b5e139f')).to.equal(true); // ERC721Metadata
      expect(await nft.supportsInterface('0x780e9d63')).to.equal(true); // ERC721Enumerable
      expect(await nft.supportsInterface('0x84b0196e')).to.equal(true); // ERC5267
      expect(await nft.supportsInterface('0x49064906')).to.equal(true); // ERC4906
      expect(await nft.supportsInterface('0xe8a3d485')).to.equal(true); // ERC7572
    });
  });
});
