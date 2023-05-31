import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, BigNumberish, ContractTransaction, Wallet } from 'ethers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { VisualKey, VisualKey__factory } from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('VisualKey', async function () {
  //#region Init Block
  const defaultMetadataUri = 'http://localhost:8080/v1/nft/tokens/';
  const defaultToken = 1;
  const defaultTokens = [1, 2, 3, 4];

  let vkFactory: VisualKey__factory;
  let defaultWallet: Wallet;
  let defaultUsers: SignerWithAddress[];

  async function deploy(params?: {
    contractOwner?: string;
    mintingSigner?: string;
    firstTokensReceiver?: string;
    lockInterval?: BigNumberish;
    metadataUri?: string;
    firstTokens?: BigNumberish[];
  }): Promise<VisualKey> {
    const contractOwner = params?.contractOwner ?? defaultUsers[0].address;
    const mintingSigner = params?.mintingSigner ?? contractOwner;
    const firstTokensReceiver = params?.firstTokensReceiver ?? contractOwner;
    const lockInterval = params?.lockInterval ?? 0;
    const metadataUri = params?.metadataUri ?? defaultMetadataUri;
    const firstTokens = params?.firstTokens ?? [];

    return await vkFactory.deploy(
      contractOwner,
      mintingSigner,
      firstTokensReceiver,
      lockInterval,
      metadataUri,
      firstTokens
    );
  }

  async function mint(params: {
    vk: VisualKey;
    signer?: Wallet;
    user: SignerWithAddress;
    token?: BigNumberish;
    price?: BigNumberish;
    payment?: BigNumberish;
    receiver?: string;
    deadline?: BigNumberish;
  }): Promise<ContractTransaction> {
    const vk = params.vk;
    const signer = params.signer ?? defaultWallet;
    const user = params.user;
    const token = params.token ?? defaultToken;
    const price = params.price ?? ethers.utils.parseEther('0.01');
    const payment = params.payment ?? price;
    const receiver = params.receiver ?? user.address;
    const deadline = params.deadline ?? ethers.constants.MaxUint256;

    const { chainId } = await ethers.provider.getNetwork();

    const hash = ethers.utils.solidityKeccak256(
      ['uint256', 'address', 'address', 'uint256', 'uint256', 'uint256'],
      [chainId, vk.address, receiver, token, price, deadline]
    );

    const signature = ethers.utils.joinSignature(signer._signingKey().signDigest(hash));

    return vk.connect(user).mint(token, price, receiver, deadline, signature, { value: payment });
  }

  before(async function () {
    defaultUsers = await ethers.getSigners();
    vkFactory = await ethers.getContractFactory('VisualKey', defaultUsers[defaultUsers.length - 1]);

    defaultWallet = (function () {
      const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
      return new ethers.Wallet(privateKey, ethers.provider);
    })();

    await defaultUsers[defaultUsers.length - 2].sendTransaction({
      to: defaultWallet.address,
      value: ethers.utils.parseEther('1.0'),
    });
  });
  //#endregion

  describe('constructor', async function () {
    it('should deploy successfully, no tokens allocation', async function () {
      const contractOwnerAddress = defaultUsers[0].address;
      const vk = await deploy({ contractOwner: contractOwnerAddress });

      expect(await vk.contractOwner()).to.equal(contractOwnerAddress);
      expect(await vk.balanceOf(contractOwnerAddress)).to.equal(BigNumber.from(0));
    });

    it('should deploy successfully and allocate first tokens', async function () {
      const contractOwnerAddress = defaultUsers[0].address;
      const vk = await deploy({ contractOwner: contractOwnerAddress, firstTokens: defaultTokens });

      expect(await vk.contractOwner()).to.equal(contractOwnerAddress);
      expect(await vk.balanceOf(contractOwnerAddress)).to.equal(BigNumber.from(defaultTokens.length));

      for (const token of defaultTokens) {
        expect(await vk.ownerOf(token)).to.equal(contractOwnerAddress);
      }
    });

    it('should fail with OwnerInvalid', async function () {
      await expect(deploy({ contractOwner: ethers.constants.AddressZero })).to.be.revertedWithCustomError(
        vkFactory,
        'OwnerInvalid'
      );
    });

    it('should fail with ReceiverInvalid', async function () {
      await expect(deploy({ firstTokensReceiver: ethers.constants.AddressZero })).to.be.revertedWithCustomError(
        vkFactory,
        'ReceiverInvalid'
      );
    });

    it('should fail with SignerInvalid', async function () {
      await expect(deploy({ mintingSigner: ethers.constants.AddressZero })).to.be.revertedWithCustomError(
        vkFactory,
        'SignerInvalid'
      );
    });

    it('should fail with TokenExists', async function () {
      await expect(deploy({ firstTokens: [1, 2, 3, 1] }))
        .to.be.revertedWithCustomError(vkFactory, 'TokenExists')
        .withArgs(1);
    });
  });

  describe('name', async function () {
    it('should return the expected name', async function () {
      const vk = await deploy();
      expect(await vk.name()).to.equal('VisualKey');
    });
  });

  describe('symbol', async function () {
    it('should return the expected symbol', async function () {
      const vk = await deploy();
      expect(await vk.symbol()).to.equal('VKEY');
    });
  });

  describe('tokenURI', async function () {
    it('should return the expected token URI', async function () {
      const firstTokens = [
        1,
        BigNumber.from('0x8ff8f0740b383135a7d3519c16273d88567ee073fa4b0e982a3dddaedc05870b'),
        BigNumber.from('0x277f1a663eb6762b1e31014c4ca9df024619b2a188a79ff1050fa14de2e343fb'),
        BigNumber.from('0xba8910a7ac014182812d10974624c673678646d1b166f957c539cd913da7313c'),
      ];

      const vk = await deploy({ firstTokens });

      for (const token of firstTokens) {
        const tokenHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(token), 32);
        const expectedUri = `${defaultMetadataUri}${tokenHex}`;
        const actualUri = await vk.tokenURI(token);

        expect(actualUri).to.equal(expectedUri);
      }
    });

    it('should fail with TokenDoesNotExist', async function () {
      const vk = await deploy();

      await expect(vk.tokenURI(defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });
  });

  describe('changeTokenMetadataURI', async function () {
    it('should change the token metadata URI', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      const someMetadataUri = 'http://localhost:8090/v1/nft/tokens/';

      await vk.connect(contractOwner).changeTokenMetadataURI(someMetadataUri);

      const tokenHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(defaultToken), 32);
      const expectedUri = `${someMetadataUri}${tokenHex}`;
      const actualUri = await vk.tokenURI(defaultToken);

      expect(actualUri).to.equal(expectedUri);
    });

    it('should fail with Unauthorized', async function () {
      const [contractOwner, user] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(vk.connect(user).changeTokenMetadataURI('')).to.be.revertedWithCustomError(
        vkFactory,
        'Unauthorized'
      );
    });
  });

  describe('totalSupply', async function () {
    it('should return the expected total supply', async function () {
      const initialTokens = [1, 2, 3];
      let tokensCount = initialTokens.length;

      const [owner, user1, user2] = defaultUsers;
      const signer = defaultWallet;

      const vk = await deploy({
        contractOwner: owner.address,
        mintingSigner: signer.address,
        firstTokensReceiver: user1.address,
        firstTokens: initialTokens,
      });

      expect(await vk.totalSupply()).to.equal(tokensCount);

      await mint({ vk, signer, user: user1, token: 4 });
      expect(await vk.totalSupply()).to.equal(++tokensCount);

      await mint({ vk, signer, user: user2, token: 5 });
      expect(await vk.totalSupply()).to.equal(++tokensCount);

      await mint({ vk, signer, user: owner, token: 6 });
      expect(await vk.totalSupply()).to.equal(++tokensCount);

      await vk.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await vk.totalSupply()).to.equal(tokensCount);

      await vk.connect(user1).transferFrom(user1.address, owner.address, 2);
      expect(await vk.totalSupply()).to.equal(tokensCount);

      await vk.connect(user2).lock(1);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      await vk.connect(owner).lock(2);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      await vk.connect(user1).lock(3);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      await vk.connect(user1).lock(4);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      await vk.connect(user2).lock(5);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      await vk.connect(owner).lock(6);
      expect(await vk.totalSupply()).to.equal(--tokensCount);

      expect(tokensCount).to.equal(0);
    });
  });

  describe('balanceOf', async function () {
    it('should return the expected balance', async function () {
      const contractOwnerAddress = defaultUsers[0].address;

      const vk = await deploy({ contractOwner: contractOwnerAddress, firstTokens: defaultTokens });

      expect(await vk.balanceOf(contractOwnerAddress)).to.equal(defaultTokens.length);
    });

    it('should fail with OwnerInvalid', async function () {
      const vk = await deploy();

      await expect(vk.balanceOf(ethers.constants.AddressZero)).to.be.revertedWithCustomError(vkFactory, 'OwnerInvalid');
    });
  });

  describe('ownerOf', async function () {
    it('should return the expected owner', async function () {
      const contractOwnerAddress = defaultUsers[0].address;

      const vk = await deploy({
        contractOwner: contractOwnerAddress,
        firstTokens: [defaultToken],
      });

      expect(await vk.ownerOf(defaultToken)).to.equal(contractOwnerAddress);
    });

    it('should fail with TokenDoesNotExist', async function () {
      const vk = await deploy();

      await expect(vk.ownerOf(defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });
  });

  describe('tokenByIndex', async function () {
    it('should return the expected token', async function () {
      const initialTokens = [1, 2];

      const [owner, user] = defaultUsers;
      const signer = defaultWallet;

      const vk = await deploy({
        contractOwner: owner.address,
        mintingSigner: signer.address,
        firstTokensReceiver: user.address,
        firstTokens: initialTokens,
      });

      for (let i = 0; i < initialTokens.length; i++) {
        expect(await vk.tokenByIndex(i)).to.equal(initialTokens[i]);
      }

      await mint({ vk, signer, user, token: 3 });
      expect(await vk.tokenByIndex(0)).to.equal(1);
      expect(await vk.tokenByIndex(1)).to.equal(2);
      expect(await vk.tokenByIndex(2)).to.equal(3);
      await expect(vk.tokenByIndex(3)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');

      await vk.connect(user).lock(2);
      expect(await vk.tokenByIndex(0)).to.equal(1);
      expect(await vk.tokenByIndex(1)).to.equal(3);
      await expect(vk.tokenByIndex(2)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');

      await mint({ vk, signer, user, token: 2 });
      await vk.connect(user).transferFrom(user.address, owner.address, 1);
      expect(await vk.tokenByIndex(0)).to.equal(1);
      expect(await vk.tokenByIndex(1)).to.equal(3);
      expect(await vk.tokenByIndex(2)).to.equal(2);
      await expect(vk.tokenByIndex(3)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');

      await vk.connect(owner).lock(1);
      expect(await vk.tokenByIndex(0)).to.equal(2);
      expect(await vk.tokenByIndex(1)).to.equal(3);
      await expect(vk.tokenByIndex(2)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');

      await vk.connect(user).lock(2);
      expect(await vk.tokenByIndex(0)).to.equal(3);
      await expect(vk.tokenByIndex(1)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');

      await vk.connect(user).lock(3);
      await expect(vk.tokenByIndex(0)).to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds');
    });

    it('should fail with IndexOutOfBounds', async function () {
      const vk = await deploy({ firstTokens: defaultTokens });

      const index = defaultTokens.length;

      await expect(vk.tokenByIndex(index))
        .to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds')
        .withArgs(index, defaultTokens.length);
    });
  });

  describe('tokenOfOwnerByIndex', async function () {
    it('should return the expected token', async function () {
      const contractOwnerAddress = defaultUsers[0].address;

      const vk = await deploy({
        contractOwner: contractOwnerAddress,
        firstTokens: defaultTokens,
      });

      for (let i = 0; i < defaultTokens.length; i++) {
        expect(await vk.tokenOfOwnerByIndex(contractOwnerAddress, i)).to.equal(defaultTokens[i]);
      }
    });

    it('should fail with OwnerInvalid', async function () {
      const vk = await deploy({
        firstTokens: defaultTokens,
      });

      await expect(vk.tokenOfOwnerByIndex(ethers.constants.AddressZero, 0)).to.be.revertedWithCustomError(
        vkFactory,
        'OwnerInvalid'
      );
    });

    it('should fail with IndexOutOfBounds', async function () {
      const contractOwnerAddress = defaultUsers[0].address;

      const vk = await deploy({
        contractOwner: contractOwnerAddress,
        firstTokens: defaultTokens,
      });

      const index = defaultTokens.length;

      await expect(vk.tokenOfOwnerByIndex(contractOwnerAddress, index))
        .to.be.revertedWithCustomError(vkFactory, 'IndexOutOfBounds')
        .withArgs(index, defaultTokens.length);
    });
  });

  describe('approve', async function () {
    it('should approve the delegate', async function () {
      const [contractOwner, delegate] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await expect(await vk.connect(contractOwner).approve(delegate.address, defaultToken))
        .to.emit(vk, 'Approval')
        .withArgs(contractOwner.address, delegate.address, defaultToken);

      expect(await vk.getApproved(defaultToken)).to.equal(delegate.address);
    });

    it('should fail with TokenDoesNotExist', async function () {
      const [contractOwner, delegate] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(vk.connect(contractOwner).approve(delegate.address, defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });

    it('should fail with DelegateInvalid', async function () {
      const [contractOwner] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await expect(
        vk.connect(contractOwner).approve(contractOwner.address, defaultToken)
      ).to.be.revertedWithCustomError(vkFactory, 'DelegateInvalid');
    });

    it('should fail with Unauthorized', async function () {
      const [contractOwner, delegate, user] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await expect(vk.connect(user).approve(delegate.address, defaultToken)).to.be.revertedWithCustomError(
        vkFactory,
        'Unauthorized'
      );
    });
  });

  describe('getApproved', async function () {
    it('should return the expected delegate', async function () {
      const [contractOwner, delegate] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await vk.connect(contractOwner).approve(delegate.address, defaultToken);

      expect(await vk.getApproved(defaultToken)).to.equal(delegate.address);
    });

    it('should fail with TokenDoesNotExist', async function () {
      const vk = await deploy();

      await expect(vk.getApproved(defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });
  });

  describe('setApprovalForAll', async function () {
    it('should set approval for all', async function () {
      const [contractOwner, operator] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(await vk.connect(contractOwner).setApprovalForAll(operator.address, true))
        .to.emit(vk, 'ApprovalForAll')
        .withArgs(contractOwner.address, operator.address, true);

      expect(await vk.isApprovedForAll(contractOwner.address, operator.address)).to.equal(true);
    });

    it('should fail with OperatorInvalid', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(
        vk.connect(contractOwner).setApprovalForAll(contractOwner.address, true)
      ).to.be.revertedWithCustomError(vkFactory, 'OperatorInvalid');
    });
  });

  describe('isApprovedForAll', async function () {
    it('should return the expected approval status', async function () {
      const [contractOwner, operator] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await vk.connect(contractOwner).setApprovalForAll(operator.address, true);
      expect(await vk.isApprovedForAll(contractOwner.address, operator.address)).to.equal(true);

      await vk.connect(contractOwner).setApprovalForAll(operator.address, false);
      expect(await vk.isApprovedForAll(contractOwner.address, operator.address)).to.equal(false);
    });
  });

  describe('transferFrom', async function () {
    it('should transfer the token from the owner to the user', async function () {
      const [contractOwner, user] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      expect(await vk.balanceOf(contractOwner.address)).to.equal(1);
      expect(await vk.balanceOf(user.address)).to.equal(0);

      await expect(await vk.connect(contractOwner).transferFrom(contractOwner.address, user.address, defaultToken))
        .to.emit(vk, 'Transfer')
        .withArgs(contractOwner.address, user.address, defaultToken);

      expect(await vk.ownerOf(defaultToken)).to.equal(user.address);
      expect(await vk.balanceOf(contractOwner.address)).to.equal(0);
      expect(await vk.balanceOf(user.address)).to.equal(1);
    });

    it('should transfer the token from the delegate to the user', async function () {
      const [contractOwner, user, delegate, receiver] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
        firstTokensReceiver: user.address,
      });

      expect(await vk.ownerOf(defaultToken)).to.equal(user.address);
      expect(await vk.balanceOf(user.address)).to.equal(1);
      expect(await vk.balanceOf(receiver.address)).to.equal(0);

      await vk.connect(user).approve(delegate.address, defaultToken);

      await expect(await vk.connect(delegate).transferFrom(user.address, receiver.address, defaultToken))
        .to.emit(vk, 'Transfer')
        .withArgs(user.address, receiver.address, defaultToken);

      expect(await vk.ownerOf(defaultToken)).to.equal(receiver.address);
      expect(await vk.balanceOf(user.address)).to.equal(0);
      expect(await vk.balanceOf(receiver.address)).to.equal(1);
    });

    it('should transfer the token from the operator to the user', async function () {
      const [contractOwner, user, operator, receiver] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: defaultTokens,
        firstTokensReceiver: user.address,
      });

      for (const token of defaultTokens) {
        expect(await vk.ownerOf(token)).to.equal(user.address);
      }

      expect(await vk.balanceOf(user.address)).to.equal(defaultTokens.length);
      expect(await vk.balanceOf(receiver.address)).to.equal(0);

      await vk.connect(user).setApprovalForAll(operator.address, true);

      for (const token of defaultTokens) {
        await expect(await vk.connect(operator).transferFrom(user.address, receiver.address, token))
          .to.emit(vk, 'Transfer')
          .withArgs(user.address, receiver.address, token);
      }

      for (const token of defaultTokens) {
        expect(await vk.ownerOf(token)).to.equal(receiver.address);
      }

      expect(await vk.balanceOf(user.address)).to.equal(0);
      expect(await vk.balanceOf(receiver.address)).to.equal(defaultTokens.length);
    });

    it('should fail with TokenDoesNotExist', async function () {
      const [contractOwner, user] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(vk.connect(contractOwner).transferFrom(contractOwner.address, user.address, defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });

    it('should fail with ReceiverInvalid', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await expect(
        vk.connect(contractOwner).transferFrom(contractOwner.address, ethers.constants.AddressZero, defaultToken)
      ).to.be.revertedWithCustomError(vkFactory, 'ReceiverInvalid');
    });

    it('should fail with Unauthorized', async function () {
      const [contractOwner, user] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      await expect(
        vk.connect(user).transferFrom(contractOwner.address, user.address, defaultToken)
      ).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });
  });

  describe('safeTransferFrom', async function () {
    it('should transfer the token from the owner to the smart contract receiver', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      const ERC721Receiver = await ethers.getContractFactory('ERC721ReceiverAccepted');
      const erc721Receiver = await ERC721Receiver.deploy();

      await expect(
        vk
          .connect(contractOwner)
          ['safeTransferFrom(address,address,uint256)'](contractOwner.address, erc721Receiver.address, defaultToken)
      )
        .to.emit(vk, 'Transfer')
        .withArgs(contractOwner.address, erc721Receiver.address, defaultToken);
    });

    it('should fail with TransferRejected', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: contractOwner.address,
        firstTokens: [defaultToken],
      });

      const ERC721Receivers = [
        await ethers.getContractFactory('ERC721ReceiverRejectedWithCode'),
        await ethers.getContractFactory('ERC721ReceiverRejectedWithEmptyError'),
        await ethers.getContractFactory('ERC721ReceiverRejectedWithReason'),
        await ethers.getContractFactory('ERC721ReceiverRejectedWithCustomError'),
      ];

      const erc721Receivers = await Promise.all(
        ERC721Receivers.map(async ERC721Receiver => {
          return await ERC721Receiver.deploy();
        })
      );

      for (const erc721Receiver of erc721Receivers) {
        await expect(
          vk
            .connect(contractOwner)
            ['safeTransferFrom(address,address,uint256)'](contractOwner.address, erc721Receiver.address, defaultToken)
        ).to.be.revertedWithCustomError(vk, 'TransferRejected');
      }
    });
  });

  describe('contractOwner', async function () {
    it('should return the expected contract owner', async function () {
      const contractOwnerAddress = defaultUsers[0].address;

      const vk = await deploy({ contractOwner: contractOwnerAddress });

      expect(await vk.contractOwner()).to.equal(contractOwnerAddress);
    });
  });

  describe('transferOwnership', async function () {
    it('should transfer ownership', async function () {
      const [contractOwner, newOwner] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await vk.connect(contractOwner).transferOwnership(newOwner.address);

      expect(await vk.contractOwner()).to.equal(newOwner.address);
    });

    it('should fail with OwnerInvalid', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(
        vk.connect(contractOwner).transferOwnership(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(vkFactory, 'OwnerInvalid');
    });

    it('should fail with Unauthorized', async function () {
      const [contractOwner, newOwner] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      await expect(vk.connect(newOwner).transferOwnership(newOwner.address)).to.be.revertedWithCustomError(
        vkFactory,
        'Unauthorized'
      );
    });
  });

  describe('mintingSigner', async function () {
    it('should return the expected minting signer', async function () {
      const mintingSigner = defaultUsers[0];

      const vk = await deploy({ mintingSigner: mintingSigner.address });

      expect(await vk.mintingSigner()).to.equal(mintingSigner.address);
    });
  });

  describe('changeMintingSigner', async function () {
    it('should change the minting signer', async function () {
      const [contractOwner, newMintingSigner] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
      });

      await vk.connect(contractOwner).changeMintingSigner(newMintingSigner.address);

      expect(await vk.mintingSigner()).to.equal(newMintingSigner.address);
    });

    it('should fail with Unauthorized', async function () {
      const [contractOwner, newMintingSigner] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
      });

      await expect(
        vk.connect(newMintingSigner).changeMintingSigner(newMintingSigner.address)
      ).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });

    it('should fail with MintingSignerInvalid', async function () {
      const contractOwner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: contractOwner.address,
      });

      await expect(
        vk.connect(contractOwner).changeMintingSigner(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(vkFactory, 'SignerInvalid');
    });
  });

  describe('mint', async function () {
    it('should mint the token', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];
      const receiver = user.address;
      const token = defaultToken;

      const vk = await deploy({ mintingSigner: await signer.getAddress() });

      await expect(mint({ vk, signer, user, token, receiver }))
        .to.emit(vk, 'Transfer')
        .withArgs(ethers.constants.AddressZero, receiver, token);

      expect(await vk.ownerOf(token)).to.equal(receiver);
    });

    it('should mint the token with zero price', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];
      const receiver = user.address;
      const token = defaultToken;
      const price = 0;

      const vk = await deploy({ mintingSigner: await signer.getAddress() });

      await expect(mint({ vk, signer, user, token, receiver, price }))
        .to.emit(vk, 'Transfer')
        .withArgs(ethers.constants.AddressZero, receiver, token);

      expect(await vk.ownerOf(token)).to.equal(receiver);
    });

    it('should fail with SignatureExpired', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];

      const vk = await deploy({ mintingSigner: await signer.getAddress() });

      const deadline = (await time.latest()) + 5 * 60;

      await time.increaseTo(deadline + 1);

      await expect(mint({ vk, signer, user, deadline })).to.be.revertedWithCustomError(vkFactory, 'SignatureExpired');
    });

    it('should fail with InsufficientFunds', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];
      const price = ethers.utils.parseEther('0.02');
      const payment = ethers.utils.parseEther('0.01');

      const vk = await deploy({ mintingSigner: await signer.getAddress() });

      await expect(mint({ vk, signer, user, price, payment }))
        .to.be.revertedWithCustomError(vkFactory, 'InsufficientFunds')
        .withArgs(payment, price);
    });

    it('should fail with TokenExists', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];
      const token = defaultToken;

      const vk = await deploy({
        mintingSigner: await signer.getAddress(),
        firstTokens: [token],
      });

      await expect(mint({ vk, signer, user, token }))
        .to.be.revertedWithCustomError(vkFactory, 'TokenExists')
        .withArgs(defaultToken);
    });

    it('should fail with ReceiverInvalid', async function () {
      const signer = defaultWallet;
      const user = defaultUsers[0];
      const receiver = ethers.constants.AddressZero;

      const vk = await deploy({ mintingSigner: await signer.getAddress() });

      await expect(mint({ vk, signer, user, receiver })).to.be.revertedWithCustomError(vkFactory, 'ReceiverInvalid');
    });

    it('should fail with SignatureInvalid', async function () {
      const fakeSigner = defaultWallet;
      const [signer, user] = defaultUsers;

      const vk = await deploy({ mintingSigner: signer.address });

      await expect(mint({ vk, signer: fakeSigner, user })).to.be.revertedWithCustomError(vkFactory, 'SignatureInvalid');
    });
  });

  describe('lock', async function () {
    it('should lock the token', async function () {
      const owner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      await expect(vk.connect(owner).lock(defaultToken))
        .to.emit(vk, 'Transfer')
        .withArgs(owner.address, ethers.constants.AddressZero, defaultToken);
    });

    it('should fail with TokenDoesNotExist', async function () {
      const owner = defaultUsers[0];

      const vk = await deploy({ contractOwner: owner.address });

      await expect(vk.connect(owner).lock(defaultToken))
        .to.be.revertedWithCustomError(vkFactory, 'TokenDoesNotExist')
        .withArgs(defaultToken);
    });

    it('should fail with TokenLocked', async function () {
      const owner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
        lockInterval: 3600,
      });

      await expect(vk.connect(owner).lock(defaultToken)).to.be.revertedWithCustomError(vkFactory, 'TokenLocked');
    });

    it('should fail with Unauthorized for an arbitrary user', async function () {
      const [owner, user] = defaultUsers;

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      await expect(vk.connect(user).lock(defaultToken)).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });

    it('should fail with Unauthorized for the delegate', async function () {
      const [owner, delegate] = defaultUsers;

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      await vk.connect(owner).approve(delegate.address, defaultToken);

      await expect(vk.connect(delegate).lock(defaultToken)).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });

    it('should fail with Unauthorized for the operator', async function () {
      const [owner, operator] = defaultUsers;

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      await vk.connect(owner).setApprovalForAll(operator.address, true);

      await expect(vk.connect(operator).lock(defaultToken)).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });

    it('should fail with Unauthorized for the contract owner and signer', async function () {
      const [contractOwner, signer, user] = defaultUsers;

      const vk = await deploy({
        contractOwner: contractOwner.address,
        mintingSigner: signer.address,
        firstTokensReceiver: user.address,
        firstTokens: [defaultToken],
      });

      await expect(vk.connect(contractOwner).lock(defaultToken)).to.be.revertedWithCustomError(
        vkFactory,
        'Unauthorized'
      );

      await expect(vk.connect(signer).lock(defaultToken)).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });
  });

  describe('getLock', async function () {
    it('should return the lock when the owner has locked the token', async function () {
      const owner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      await vk.connect(owner).lock(defaultToken);

      const tokenLock = await vk.getLock(defaultToken);

      expect(tokenLock.lockedBy).to.equal(owner.address);
      expect(tokenLock.timestamp).to.be.greaterThan(BigNumber.from(0));
    });

    it('should return the lock with positive timestamp when token is minted', async function () {
      const owner = defaultUsers[0];

      const vk = await deploy({
        contractOwner: owner.address,
        firstTokens: [defaultToken],
      });

      const lock = await vk.getLock(defaultToken);

      expect(lock.lockedBy).to.equal(ethers.constants.AddressZero);
      expect(lock.timestamp).to.be.greaterThan(BigNumber.from(0));
    });

    it('should return an empty lock for not existing token', async function () {
      const vk = await deploy();
      const lock = await vk.getLock(defaultToken);

      expect(lock.lockedBy).to.equal(ethers.constants.AddressZero);
      expect(lock.timestamp).to.equal(BigNumber.from(0));
    });
  });

  describe('getLockInterval', async function () {
    it('should return the lock interval', async function () {
      const lockInterval = 3600;
      const vk = await deploy({ lockInterval });
      expect(await vk.getLockInterval()).to.equal(lockInterval);
    });
  });

  describe('setLockInterval', async function () {
    it('should set the lock interval', async function () {
      const owner = defaultUsers[0];
      const lockInterval = 3600;

      const vk = await deploy({
        contractOwner: owner.address,
        lockInterval,
      });

      await vk.connect(owner).setLockInterval(lockInterval);

      expect(await vk.getLockInterval()).to.equal(lockInterval);
    });

    it('should fail with Unauthorized', async function () {
      const [owner, user] = defaultUsers;

      const vk = await deploy({ contractOwner: owner.address });

      await expect(vk.connect(user).setLockInterval(3600)).to.be.revertedWithCustomError(vkFactory, 'Unauthorized');
    });
  });

  describe('supportsInterface', async function () {
    it('should support IERC721, IERC721Metadata, IERC721Enumerable, IERC721Receiver, IERC165', async function () {
      const vk = await deploy();

      const interfaceIds = [
        '0x80ac58cd', // IERC721
        '0x5b5e139f', // IERC721Metadata
        '0x780e9d63', // IERC721Enumerable
        '0x150b7a02', // IERC721Receiver
        '0x01ffc9a7', // IERC165
      ];

      for (const interfaceId of interfaceIds) {
        expect(await vk.supportsInterface(interfaceId)).to.be.true;
      }
    });
  });

  describe('onERC721Received', async function () {
    it('should accept any ERC721 token', async function () {
      const vk = await deploy();

      expect(
        await vk.onERC721Received(ethers.constants.AddressZero, ethers.constants.AddressZero, 0, '0x')
      ).to.be.equal('0x150b7a02');
    });
  });

  describe('receive', async function () {
    it('should accept a donation', async function () {
      const [contractOwner, user] = defaultUsers;

      const vk = await deploy({ contractOwner: contractOwner.address });

      const donationAmount = ethers.utils.parseEther('1');

      await expect(
        user.sendTransaction({
          to: vk.address,
          value: donationAmount,
        })
      )
        .to.emit(vk, 'Donation')
        .withArgs(user.address, donationAmount);

      expect(await ethers.provider.getBalance(vk.address)).to.be.equal(donationAmount);
    });
  });
});
