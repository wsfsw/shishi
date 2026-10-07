import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDateRange,messageInDateRange,sameDateRange} from '../message-date-range.mjs';
test('消息日期范围按北京时间包含整天，排除未知发送日',()=>{
 const range=normalizeDateRange({start:'2026-10-06',end:'2026-10-06'});
 assert.equal(messageInDateRange('2026-10-05T15:59:59Z',range),false);
 assert.equal(messageInDateRange('2026-10-05T16:00:00Z',range),true);
 assert.equal(messageInDateRange('2026-10-06T23:59:59+08:00',range),true);
 assert.equal(messageInDateRange('2026-10-06T16:00:00Z',range),false);
 assert.equal(messageInDateRange(null,range),false);
 assert.equal(messageInDateRange('2026-10-06',range),false);
 assert.equal(messageInDateRange(null,normalizeDateRange()),true);
});
test('日期单边范围及非法范围校验',()=>{
 assert.equal(messageInDateRange('2026-10-07T00:00:00+08:00',{start:'2026-10-06',end:null}),true);
 assert.equal(messageInDateRange('2026-10-05T00:00:00+08:00',{start:null,end:'2026-10-06'}),true);
 for(const value of [{start:'2026-02-30'}, {start:'2026-10-07',end:'2026-10-06'}, {end:false},null])assert.throws(()=>normalizeDateRange(value));
 assert.deepEqual(normalizeDateRange({start:'',end:''}),{start:null,end:null});
 assert.equal(sameDateRange({start:null,end:null},{start:'2026-10-06',end:null}),false);
});
