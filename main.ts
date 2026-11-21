import{mkdirSync as M,readdirSync as R,readFileSync as F,writeFileSync as W}from'node:fs'
let I=process.env.MAKEFUN_INPUT_DIR||'/input',O=process.env.MAKEFUN_OUTPUT_DIR||'/output',C='udlr'
let S=t=>{
let L=t.split('\n').filter(x=>x),w=Math.max(...L.map(x=>x.length)),n=w*L.length,A=new Uint8Array(n),G=new Set,B=[],P=-1
L.map((r,y)=>{for(let x=0;x<r.length;x++){let c=r[x],i=y*w+x
if(c!='#'){A[i]=1;if('.+*'.includes(c))G.add(i);if('$*'.includes(c))B.push(i);if('@+'.includes(c))P=i}}})
let D=[-w,w,-1,1],pr=P/w|0,seen=new Uint8Array(n),rooms=[],nb2=0
for(let i=0;i<n;i++){if(!A[i]||(i/w|0)==pr||seen[i])continue
let cells=[],q=[i];seen[i]=1
while(q.length){let c=q.pop();cells.push(c)
for(let o of D){let m=c+o;if(A[m]&&(m/w|0)!=pr&&!seen[m]){seen[m]=1;q.push(m)}}}
let bs=cells.filter(c=>B.includes(c));nb2+=bs.length
if(bs.length)rooms.push([cells,bs,cells.filter(c=>G.has(c))])}
if(!rooms.length||rooms.some(r=>r[1].length!=r[2].length)||nb2!=B.length)return''
let H=[];for(let x=pr*w;x<pr*w+w;x++)if(A[x])H.push(x)
let all=new Set(B),ans=''
let flood=(ob,bx,fr)=>{let bl=ob.slice();for(let b of bx)bl[b]=1
let sn=new Uint8Array(n),par=[],q=[fr],mn=fr;sn[fr]=1
for(let qi=0;qi<q.length;qi++){let c=q[qi]
for(let d=0;d<4;d++){let m=c+D[d]
if(A[m]&&!bl[m]&&!sn[m]){sn[m]=1;par[m]=c*4+d;q.push(m);if(m<mn)mn=m}}}
return[sn,par,mn]}
for(let ri=0;ri<rooms.length;ri++){let r=rooms[ri],last=ri==rooms.length-1
let live=new Set(r[2]),q=[...r[2]]
while(q.length){let c=q.pop()
for(let d=0;d<4;d++){let b=c-D[d],s=b-D[d]
if(r[0].includes(b)&&A[s]&&!live.has(b)){live.add(b);q.push(b)}}}
let ob=new Uint8Array(n);for(let b of all)if(!r[1].includes(b))ob[b]=1
let start=r[1].slice().sort((a,b)=>a-b)
let st=[[start,P,'']],vis=new Set([start+'|'+flood(ob,start,P)[2]]),res=null
for(let qi=0;qi<st.length&&!res;qi++){let[bxs,pp,mm]=st[qi]
let f2=flood(ob,bxs,pp)
for(let b of bxs)for(let d=0;d<4;d++){let stand=b-D[d],tgt=b+D[d]
if(!f2[0][stand]||!r[0].includes(tgt)||bxs.includes(tgt)||!live.has(tgt))continue
let nb=bxs.map(x=>x==b?tgt:x).sort((a,b2)=>a-b2)
let nf=flood(ob,nb,b),key=nb+'|'+nf[2]
if(vis.has(key))continue
vis.add(key)
let ws='';for(let v=stand;f2[1][v]>=0;){let u=f2[1][v];ws=C[u%4]+ws;v=u/4|0}
let nm=mm+ws+C[d]
if(nb.every(x=>r[2].includes(x))&&(last||H.some(hc=>nf[0][hc]))){res=[nm,b,nb];break}
st.push([nb,b,nm])}}
if(!res)return''
ans+=res[0]
for(let b of r[1])all.delete(b)
for(let b of res[2])all.add(b)
P=res[1]}
return ans}
for(let id of R(I)){let m=''
try{m=S(F(I+'/'+id+'/level.txt','utf8'))}catch{}
M(O+'/'+id,{recursive:true});W(O+'/'+id+'/solution.txt',m)}
