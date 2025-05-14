import hre, { ethers } from 'hardhat';

async function main() {
  const ownerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, ethers.provider);
  const ownerAddress = await ownerWallet.getAddress();

  //#region Deploy Token Contract
  const token = await ethers.deployContract('VisualKeyToken', [ownerAddress, ownerAddress, 0n]);
  await token.waitForDeployment();
  //#endregion

  //#region Deploy Nft Contract
  const nft = await ethers.deployContract('VisualKeyNft', [
    ownerAddress,
    'http://localhost:8080/v1/nft',
    'http://localhost:8080/v1/nft/tokens/',
    await token.getAddress(),
  ]);

  await nft.waitForDeployment();
  //#endregion

  //#region Deploy TokenSale Contract
  const tokenSale = await ethers.deployContract('VisualKeyTokenSale', [
    ownerAddress,
    await token.getAddress(),
    1_000_000_000_000_000_000n,
  ]);

  await tokenSale.waitForDeployment();
  //#endregion

  //#region Transfer tokens to VisualKeyTokenSale.sol contract
  const transferAmount = 100_000n * 10n ** 18n;
  await token.transfer(await tokenSale.getAddress(), transferAmount);
  //#endregion

  //region Deploy Multicall3
  const multicall3 = (await hre.artifacts.readArtifact('Multicall3')).deployedBytecode;

  await hre.network.provider.send('hardhat_setCode', ['0xcA11bde05977b3631167028862bE2a173976CA11', multicall3]);
  //endregion

  console.log(`Owner address: ${ownerAddress}`);
  console.log(`Token address: ${await token.getAddress()}`);
  console.log(`Nft address: ${await nft.getAddress()}`);
  console.log(`TokenSale address: ${await tokenSale.getAddress()}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
