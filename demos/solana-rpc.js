/** Require explicit RPC evidence; missing fields must not look like successful simulation. */
export function decodeRpc(data){
 if(!data||data.jsonrpc!=='2.0'||data.id!==1)throw Error('Invalid devnet RPC response');
 if(data.error)throw Error(`Devnet RPC error: ${JSON.stringify(data.error)}`);
 if(!Object.hasOwn(data,'result'))throw Error('Devnet RPC response missing result');
 return data.result;
}
export function requireSimulationResult(result){
 if(!result?.value||!Object.hasOwn(result.value,'err'))throw Error('Devnet simulation missing execution result');
 return result.value;
}
