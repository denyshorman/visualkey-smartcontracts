# VisualKey Smart Contracts

This repository contains the smart contracts for the VisualKey project, including an ERC-20 token and an ERC-721 NFT with advanced features.

## Contracts

- **VisualKeyToken**: ERC-20 compatible token with EIP-2612 permit, EIP-1363 (transfer/approve and call), EIP-3156 flash loans, and controlled minting.
- **VisualKeyNft**: ERC-721 NFT contract with EIP-712 signature-based minting, rarity system, and metadata management.

## Features

### VisualKeyToken (ERC-20)
- Standard ERC-20 interface
- EIP-2612 permit (gasless approvals)
- EIP-1363 (transfer/approve and call)
- EIP-3156 flash loans
- Controlled minting with time windows and signature authorization
- Burnable tokens
- Ownership transfer with delay and renounce

### VisualKeyNft (ERC-721)
- Standard ERC-721, ERC-721Enumerable, ERC-721Metadata
- EIP-712 signature-based minting (proves private key ownership)
- Rarity system (level, power, creation date)
- Metadata and contract URI management
- Power increase (with permit or allowance)
- Ownership transfer with delay and renounce

## Development

### Install dependencies

```sh
npm install
```

### Compile contracts

```sh
npx hardhat compile
```

### Run tests

```sh
npx hardhat test
```

### Running a Local Hardhat Node & Deploying Contracts

You can use the provided npm scripts to spin up a local Hardhat node and deploy all contracts automatically:

```sh
# Start a local Hardhat node (in a separate terminal)
npm run start-local-node

# In another terminal, deploy contracts to the local node
npm run deploy-visualkey-contract
```

The deployment script will:
- Deploy the Token, Nft, and TokenSale contracts
- Transfer tokens to the TokenSale contract
- Deploy Multicall3 to a standard address

After deployment, contract addresses will be printed to the console.

## File Structure

- `contracts/` — Main smart contracts (Token, Nft, and supporting libraries)
- `test/Token.ts` — ERC-20 token tests
- `test/Nft.ts` — ERC-721 NFT tests
- `scripts/deploy.ts` — Deployment script
