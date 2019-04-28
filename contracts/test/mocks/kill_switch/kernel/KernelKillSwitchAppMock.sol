pragma solidity 0.4.24;

import "../../../../apps/AragonApp.sol";


contract KernelKillSwitchAppMock is AragonApp {
    address public owner;
    uint256 internal data;

    function initialize(address _owner) public onlyInit {
        initialized();
        data = 42;
        owner = _owner;
    }

    function read() public view returns (uint256) {
        return data;
    }

    function write(uint256 _data) public {
        data = _data;
    }

    function reset() public {
        data = 0;
    }
}
