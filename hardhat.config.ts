import { HardhatUserConfig } from 'hardhat/config';

import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-ethers';
import '@nomiclabs/hardhat-solhint';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.30',
    settings: {
      optimizer: {
        enabled: true,
        runs: 2500,
      },
      viaIR: true,
      evmVersion: 'prague',
    },
  },
};

export default config;
