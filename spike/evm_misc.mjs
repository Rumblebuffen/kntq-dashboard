import { rpc, balanceOf, blockTs } from './evm.mjs';
const iso = async b => new Date(1000 * await blockTs(b)).toISOString();
for (const b of [47339847, 47374388, 48711956, 49237977, 49249675, 49938157, 50426586, 50505006, 50747352, 35530796, 44049980, 46690845]) console.log('block', b, await iso(b));
for (const a of ['0x435bb7ea4eb481cb686606d089ea4dee4c6cc03b', '0x7af5d1fdbfeb917c46ebe273fd44e5d59ae0502d', '0x132213efec1f9b999c063ff5aeb5c623934e7b4b', '0xfc82b4225120db7c257ad8c69a8cf07319bfb88b', '0x99ed257a514d81a62c3195934d4e63a1c2c3946a', '0xd8664e2793dc6b6810a7bfb5f81347b181e1e26f', '0x880322604e214b592c7567fd2dfcf7a8f2265cff', '0x724f83751bfe73385d59a63dd8fa291913f9cb95']) {
  const code = await rpc('eth_getCode', [a, 'latest']);
  console.log(a, 'KNTQ', await balanceOf(a), 'codeBytes', (code.length - 2) / 2, 'nonce', parseInt(await rpc('eth_getTransactionCount', [a, 'latest'])));
}
