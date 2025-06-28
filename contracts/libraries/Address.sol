// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library Address {
    function isContract(address account) internal view returns (bool) {
        return account.code.length > 0;
    }

    function isExternallyOwnedAccount(address account) internal view returns (bool) {
        return account.code.length == 0;
    }
}
