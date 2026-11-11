import { rpc, balanceOf } from './evm.mjs';
const W = { contributors_235M: '0x373e0b6b57818ac2bb3a3e55e31128d5f880d90e', investors_75M: '0x9ef3b3a49ee9a2fd28a10f6e9407219e7ceca1a2', foundation_100M: '0xf50ad63714f10f4e96eeabd43d549c8232992b36', growth_300M: '0x5bd9e766c0151dcfbc4246e5f8b3193c4beeaae4', liquidity_20M: '0x4664b0453c7c483e2e262ca54351ade71b6be734', bridge: '0x200000000000000000000000000000000000007c' };
const IMPL_SLOT = '0x360894a13ba1a3210667c824bc13b53a38a2bc9d2ca505bbc7de0d34b0a02a2' + 'c'.replace('c','bc').slice(-2); // placeholder, fixed below
const EIP1967 = '0x360894a13ba1a3210667c824bc13b53a38a2bc9d2ca505bbc7de0d34b0a02a2bbc'.slice(0, 66);
for (const [k, a] of Object.entries(W)) {
  const code = await rpc('eth_getCode', [a, 'latest']);
  const nonce = parseInt(await rpc('eth_getTransactionCount', [a, 'latest']));
  const bal = await balanceOf(a);
  let impl = '';
  if (code.length > 2) impl = await rpc('eth_getStorageAt', [a, '0x360894a13ba1a3210667c824bc13b53a38a2bc9d2ca505bbc7de0d34b0a02a2bbc'.slice(0,66), 'latest']).catch(e => 'err');
  console.log(k, a, 'KNTQ', bal, 'codeBytes', (code.length - 2) / 2, 'nonce', nonce, impl ? 'impl ' + impl : '', code.length > 2 && code.length < 400 ? code : '');
}
