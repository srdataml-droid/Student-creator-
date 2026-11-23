/** Synthetic disposable fixture only. Output contains session tokens: keep private. */
import {writeFileSync} from 'node:fs';
import {commerceFixture} from '../packages/local-core/test/helpers/commerce-fixture.mjs';
const destination=process.argv[2];
if(process.env.NODE_ENV==='production'||!destination)throw Error('Provide a private temporary JSON output path in a nonproduction environment');
const f=commerceFixture();
try{
 writeFileSync(destination,JSON.stringify({path:f.path,id:f.id,order:f.order,buyer:f.buyer,creator:f.creator,other:f.other,admin:f.admin}),{mode:0o600,flag:'wx'});
 console.log('Synthetic fixture ready; use its path privately. No PSP requests made.');
}finally{f.db.close();f.store.close();}
