export function normalizeDateRange(value={start:null,end:null}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('整理日期范围格式不正确');
 if(['start','end'].some(k=>value[k]!=null&&typeof value[k]!=='string'))throw new Error('请选择有效的整理日期');
 const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v.slice(0,4)!=='0000'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const range={start:value.start||null,end:value.end||null};
 if((range.start!==null&&!valid(range.start))||(range.end!==null&&!valid(range.end)))throw new Error('请选择有效的整理日期');
 if(range.start&&range.end&&range.start>range.end)throw new Error('开始日期不能晚于结束日期');
 return range;
}
export function messageInDateRange(sentAt,range){
 if(!range.start&&!range.end)return true;
 if(typeof sentAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(sentAt))return false;
 const stamp=Date.parse(sentAt);if(!Number.isFinite(stamp))return false;
 const start=range.start?Date.parse(range.start+'T00:00:00+08:00'):-Infinity;
 const end=range.end?Date.parse(range.end+'T00:00:00+08:00')+86400000:Infinity;
 return stamp>=start&&stamp<end;
}
export function sameDateRange(a,b){return a.start===b.start&&a.end===b.end;}
