import { expect, test } from 'vitest';
import { getAdapter } from '../../server/adapters/index.js';
import { withMetadata } from '../../server/adapters/metadata.js';
import { ModelUsageLedger } from '../../server/model-usage.js';

test('Qoder final run totals preserve the allocations of both models without assigning everything to the last model', () => {
  const parse = withMetadata(getAdapter('qodercli').createParser(), 'qodercli');
  const ledger = new ModelUsageLedger();
  const records = [
    { type:'assistant',message:{id:'one',model:'model-a',content:[{type:'text',text:'one'}],usage:{input_tokens:10,output_tokens:2,credits:1,billable:true}} },
    { type:'assistant',message:{id:'two',model:'model-b',content:[{type:'text',text:'two'}],usage:{input_tokens:20,output_tokens:4,credits:2,billable:true}} },
    { type:'result',total_cost_usd:0,total_credits:3,usage:{input_tokens:30,output_tokens:6} },
  ];
  for (const record of records) for (const event of parse(JSON.stringify(record),'stdout')) {
    if (event.kind === 'model') ledger.addModel(event.model,'reported',event.provider ?? null);
    if (event.kind === 'usage') ledger.addUsage(event);
  }
  const rows = ledger.rows('qodercli');
  expect(ledger.totals()).toMatchObject({inputTokens:30,outputTokens:6,credits:3});
  expect(rows.find(row=>row.model==='model-a')).toMatchObject({inputTokens:10,outputTokens:2,credits:1});
  expect(rows.find(row=>row.model==='model-b')).toMatchObject({inputTokens:20,outputTokens:4,credits:2});
});
