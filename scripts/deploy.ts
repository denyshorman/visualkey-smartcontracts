import { ethers } from 'hardhat';

async function main() {
  const VisualKey = await ethers.getContractFactory('VisualKey');

  const ownerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, ethers.provider);
  const ownerAddress = await ownerWallet.getAddress();
  const metaUrl = 'http://localhost:8080/v1/nft/tokens/';
  const lockInterval = 0;

  const visualKey0 = await VisualKey.deploy(ownerAddress, ownerAddress, ownerAddress, lockInterval, metaUrl, [1, 3]);
  const visualKey1 = await VisualKey.deploy(ownerAddress, ownerAddress, ownerAddress, lockInterval, metaUrl, [2]);

  await visualKey0.connect(ownerWallet).lock(3);

  console.log(`Owner address: ${ownerAddress}`);
  console.log(`VisualKey0 address: ${visualKey0.address}`);
  console.log(`VisualKey1 address: ${visualKey1.address}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
