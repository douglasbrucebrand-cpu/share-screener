// VERBATIM copy of the scoring code from tech-growth-screener.html (lines 178-214)
// plus the composite line from computeRow() (line 279). Do not edit: the parity
// test checks pipeline/scoring.py against exactly this code.
const sma=(a,n)=>a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n;
function maxDD(a){let peak=a[0],dd=0;for(const v of a){if(v>peak)peak=v;const d=(v-peak)/peak;if(d<dd)dd=d;}return dd;}

function momentum(prices){
  const c=prices.map(p=>p.close), v=prices.map(p=>p.volume||0);
  if(c.length<60) return {score:null,sig:[],ret1m:null,ret3m:null,vsSMA50:null};
  const last=c[c.length-1];
  const s20=sma(c,20),s50=sma(c,50),s100=sma(c.slice(-100>-c.length?-Math.min(100,c.length):0),Math.min(100,c.length));
  const s50_prev=sma(c.slice(0,c.length-20),50);
  const ret1m=last/c[c.length-22]-1;
  const ret3m=c.length>=64?last/c[c.length-64]-1:null;
  const dd1m=maxDD(c.slice(-22));
  const vol10=sma(v,10),vol50=sma(v,50);
  const volRatio=vol50?vol10/vol50:1;
  const vsSMA50=s50?last/s50-1:null;
  let score=0; const sig=[];
  if(s50 && last>s50){score+=20; sig.push(['Above 50-day','g']);}
  if(s20 && s50 && s20>s50){score+=15; sig.push(['Short trend up','g']);}
  if(s50 && s50_prev && s50>s50_prev){score+=15; sig.push(['50-day rising','g']);}
  if(ret1m>0){score+=Math.min(20, ret1m/0.12*20); sig.push([`1M ${(ret1m*100).toFixed(0)}%`, ret1m>0.03?'g':'']);}
  if(dd1m>-0.08){score+=15; sig.push(['Steady','g']);}
  if(volRatio>1.05){score+=10; sig.push(['Volume rising','g']);}
  if(vsSMA50!=null){ if(vsSMA50<0.25) score+=5; else if(vsSMA50>0.35) sig.push(['Overextended','w']); }
  return {score:Math.round(Math.max(0,Math.min(100,score))),sig,ret1m,ret3m,vsSMA50};
}

function fundamentals(y){
  if(!y||y.length<2) return {score:null,sig:[],revg:null};
  const revg=(y[0].rev-y[1].rev)/Math.abs(y[1].rev||1);
  const revg_prev=y.length>=3?(y[1].rev-y[2].rev)/Math.abs(y[2].rev||1):null;
  const gm0=y[0].rev?y[0].gp/y[0].rev:null, gm1=y[1].rev?y[1].gp/y[1].rev:null;
  let score=0; const sig=[];
  if(isFinite(revg)){ score+=Math.max(0,Math.min(50, revg/0.30*50)); sig.push([`Rev ${(revg*100).toFixed(0)}%`, revg>0.1?'g':'']);}
  if(revg_prev!=null && revg>revg_prev){score+=25; sig.push(['Accelerating','g']);}
  if(gm0!=null && gm1!=null && gm0>gm1){score+=25; sig.push(['Margins up','g']);}
  return {score:Math.round(Math.max(0,Math.min(100,score))),sig,revg};
}

function compositeOf(m,f){ return m.score==null?null:(f.score==null?m.score:Math.round(0.6*m.score+0.4*f.score)); }
module.exports={sma,maxDD,momentum,fundamentals,compositeOf};
