const publicPrefixes=['EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'];
export function rpcResult(response,value){
 if(!response.ok||!value||value.jsonrpc!=='2.0'||value.id!==1||value.error||!Object.hasOwn(value,'result'))throw Error('Invalid local RPC response; require HTTP success and matching JSON-RPC envelope');
 return value.result;
}
export function validatePin(genesis,pinned){
 if(typeof genesis!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(genesis)||publicPrefixes.some(hash=>genesis.startsWith(hash)))throw Error('Public cluster or malformed local genesis rejected');
 if(pinned&&(pinned.rpc!=='http://127.0.0.1:8899'||pinned.genesis!==genesis))throw Error('Local ledger changed. Keep the prior ledger; existing payments require explicit migration.');
}
