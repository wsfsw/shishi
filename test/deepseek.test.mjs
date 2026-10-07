import test from 'node:test';
import assert from 'node:assert/strict';
import {extractDeepSeek,validateResult,testDeepSeek} from '../deepseek.mjs';
const message={id:'m1',sender:'老师',text:'请大家明天下午3点开会',sentAt:null};
const item={title:'参加会议',category:'会议',dueAt:'2026-10-07T15:00:00+08:00',precision:'minute',audience:'all',priority:'normal',sourceIds:['m1'],reason:''};
test('DeepSeek 校验：未知发送日不填相对日期、来源不可编造、过滤类型和他人事项',()=>{
 const result=validateResult({tasks:[item,{...item,category:'费用'},{...item,audience:'others'}],summaries:[{category:'会议',text:'开会通知',sourceIds:['m1']}]},[message],['会议']);
 assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].dueAt,null);assert.equal(result.tasks[0].precision,'uncertain');
 assert.throws(()=>validateResult({tasks:[{...item,sourceIds:['invented']}],summaries:[]},[message],['会议']),/来源/);
 assert.throws(()=>validateResult({tasks:[{...item,dueAt:'2026-02-30',precision:'date'}],summaries:[]},[message],['会议']),/日期/);
});
test('DeepSeek 请求只包含消息字段；返回结果经过验证，不信任模型的状态',async()=>{
 let body;
 const fetchImpl=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-key');body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({tasks:[{...item,status:'pending'}],summaries:[]})}}]})};};
 const result=await extractDeepSeek([{...message,secret:'not-transmitted',sentAt:'2026-10-06T12:00:00+08:00'}],{group:'已选群',categories:['会议'],apiKey:'test-key',fetchImpl});
 assert(!body.messages[1].content.includes('not-transmitted'));assert.equal(result.tasks[0].dueAt,item.dueAt);assert.equal(result.tasks[0].status,undefined);assert.equal(body.response_format.type,'json_object');
});
test('DeepSeek 失败、截断和无类别均不产生事项，错误不回显响应或密钥',async()=>{
 await assert.rejects(testDeepSeek({apiKey:'test-key',fetchImpl:async()=>({ok:false,status:401,text:()=>Promise.resolve('test-key private')})}),e=>/API Key 无效/.test(e.message)&&!e.message.includes('test-key'));
 await assert.rejects(extractDeepSeek([message],{categories:['会议'],apiKey:'test-key',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})})}),/未完成/);
 assert.deepEqual(await extractDeepSeek([message],{categories:[],fetchImpl:()=>assert.fail('No selected categories')}),{tasks:[],summaries:[]});
});
