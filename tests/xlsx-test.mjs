// The Excel writer makes a zip Excel can open: stored entries, correct CRCs, the parts it needs.
// Run: node tests/xlsx-test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const X = require('../xlsx.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
ok(X.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'CRC-32 check value');
const bytes = X.build([{ name: 'Cables', rows: [['Ref', 'Size'], ['DB1/1', 2.5], ['<&>', null]] }, { name: 'Bad/Name?', rows: [['a']] }]);
const txt = new TextDecoder().decode(bytes);
ok(bytes[0] === 0x50 && bytes[1] === 0x4b, 'zip signature');
['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', '_rels/.rels'].forEach(n => ok(txt.includes(n), 'has ' + n));
ok(txt.includes('&lt;&amp;&gt;'), 'text is escaped');
ok(txt.includes('<v>2.5</v>'), 'numbers stay numbers');
ok(!txt.includes('Bad/Name?'), 'sheet names cleaned');
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
