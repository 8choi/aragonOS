const { assertRevert } = require('../../helpers/assertThrow')

const IssuesRegistry = artifacts.require('IssuesRegistry')
const KernelKillSwitchAppMock = artifacts.require('KernelKillSwitchAppMock')

const ACL = artifacts.require('ACL')
const RegularKernel = artifacts.require('Kernel')
const KernelKillSwitch = artifacts.require('KernelBinaryKillSwitch')
const DAOFactory = artifacts.require('DAOFactory')
const EVMScriptRegistryFactory = artifacts.require('EVMScriptRegistryFactory')

const SEVERITY = { NONE: 0, LOW: 1, MID: 2, HIGH: 3, CRITICAL: 4 }

const getEventArgument = (receipt, event, arg) => receipt.logs.find(l => l.event === event).args[arg]

contract('KernelBinaryKillSwitch', ([_, root, owner, securityPartner, anyone]) => {
  let killSwitchedKernelBase, regularKernelBase, aclBase, appBase, issuesRegistryBase, registryFactory
  let regularDao, regularAcl, killSwitchedDao, killSwitchedAcl, issuesRegistry, app

  before('deploy base implementations', async () => {
    regularKernelBase = await RegularKernel.new(true) // petrify immediately
    killSwitchedKernelBase = await KernelKillSwitch.new(true) // petrify immediately
    aclBase = await ACL.new()
    appBase = await KernelKillSwitchAppMock.new()
    issuesRegistryBase = await IssuesRegistry.new()
    registryFactory = await EVMScriptRegistryFactory.new()
  })

  beforeEach('deploy DAO with regular kernel', async () => {
    const regularDaoFactory = await DAOFactory.new(regularKernelBase.address, aclBase.address, registryFactory.address)
    const regularKernelReceipt = await regularDaoFactory.newDAO(root)
    regularDao = RegularKernel.at(getEventArgument(regularKernelReceipt, 'DeployDAO', 'dao'))
    regularAcl = ACL.at(await regularDao.acl())

    const APP_MANAGER_ROLE = await regularKernelBase.APP_MANAGER_ROLE()
    await regularAcl.createPermission(root, regularDao.address, APP_MANAGER_ROLE, root, { from: root })
  })

  beforeEach('create issues registry app from DAO with regular kernel', async () => {
    const issuesRegistryReceipt = await regularDao.newAppInstance('0x1234', issuesRegistryBase.address, '0x', false, { from: root })
    issuesRegistry = IssuesRegistry.at(getEventArgument(issuesRegistryReceipt, 'NewAppProxy', 'proxy'))
    await issuesRegistry.initialize()
    const SET_ENTRY_SEVERITY_ROLE = await issuesRegistryBase.SET_ENTRY_SEVERITY_ROLE()
    await regularAcl.createPermission(securityPartner, issuesRegistry.address, SET_ENTRY_SEVERITY_ROLE, root, { from: root })
  })

  beforeEach('deploy DAO with kernel binary kill switch', async () => {
    const killSwitchedDaoFactory = await DAOFactory.new(killSwitchedKernelBase.address, aclBase.address, registryFactory.address)
    const killSwitchedKernelReceipt = await killSwitchedDaoFactory.newDAOWithKillSwitch(root, issuesRegistry.address)
    killSwitchedDao = KernelKillSwitch.at(getEventArgument(killSwitchedKernelReceipt, 'DeployDAO', 'dao'))
    killSwitchedAcl = ACL.at(await killSwitchedDao.acl())

    const APP_MANAGER_ROLE = await killSwitchedKernelBase.APP_MANAGER_ROLE()
    await killSwitchedAcl.createPermission(root, killSwitchedDao.address, APP_MANAGER_ROLE, root, { from: root })
    const SET_IGNORED_CONTRACTS_ROLE = await killSwitchedDao.SET_IGNORED_CONTRACTS_ROLE()
    await killSwitchedAcl.createPermission(owner, killSwitchedDao.address, SET_IGNORED_CONTRACTS_ROLE, root, { from: root })
  })

  beforeEach('create sample app from DAO with kernel binary kill switch', async () => {
    const appReceipt = await killSwitchedDao.newAppInstance('0x1235', appBase.address, '0x', false, { from: root })
    app = KernelKillSwitchAppMock.at(getEventArgument(appReceipt, 'NewAppProxy', 'proxy'))
    await app.initialize(owner)
  })

  const itExecutesTheCall = () => {
    it('executes the call', async () => {
      assert.equal(await app.read(), 42)
    })
  }

  const itDoesNotExecuteTheCall = () => {
    it('does not execute the call', async () => {
      await assertRevert(app.read(), 'KERNEL_CONTRACT_CALL_NOT_ALLOWED')
    })
  }

  context('when there is no bug registered', () => {
    context('when the contract being called is not ignored', () => {
      itExecutesTheCall()
    })

    context('when the contract being called is ignored', () => {
      beforeEach('ignore calling contract', async () => {
        await killSwitchedDao.setContractIgnore(appBase.address, true, { from: owner })
      })

      itExecutesTheCall()
    })
  })

  context('when there is a bug registered', () => {
    beforeEach('register a bug', async () => {
      await issuesRegistry.setSeverityFor(appBase.address, SEVERITY.LOW, { from: securityPartner })
    })

    context('when the bug was not fixed yet', () => {
      context('when the contract being called is not ignored', () => {
        itDoesNotExecuteTheCall()
      })

      context('when the contract being called is ignored', () => {
        beforeEach('ignore calling contract', async () => {
          await killSwitchedDao.setContractIgnore(appBase.address, true, { from: owner })
        })

        itExecutesTheCall()
      })
    })

    context('when the bug was already fixed', () => {
      beforeEach('fix bug', async () => {
        await issuesRegistry.setSeverityFor(appBase.address, SEVERITY.NONE, { from: securityPartner })
      })

      context('when the contract being called is not ignored', () => {
        itExecutesTheCall()
      })

      context('when the contract being called is ignored', () => {
        beforeEach('ignore calling contract', async () => {
          await killSwitchedDao.setContractIgnore(appBase.address, true, { from: owner })
        })

        itExecutesTheCall()
      })
    })
  })
})
