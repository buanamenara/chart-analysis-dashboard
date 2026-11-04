"""Bounded, reproducible public-proxy research. No broker API or orders."""
import os
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
import json, hashlib, sys, time, platform, urllib.request, urllib.parse, traceback
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import sklearn
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / 'cache'
OUT = ROOT / 'results'
START = int(pd.Timestamp('2026-08-06', tz='UTC').timestamp()*1000)
END = int(pd.Timestamp('2026-11-04', tz='UTC').timestamp()*1000)
H = 30
SEED = 271828
THRESHOLDS = [0.40, 0.50, 0.60, 0.70]
BASE = 'https://data-api.binance.vision/api/v3/klines'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def fetch(symbol):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'{symbol}_1m_{START}_{END}.csv'
    calls = 0
    if not path.exists():
        rows = []
        cursor = START
        while cursor < END:
            if calls >= 135:
                raise RuntimeError('Per-symbol request cap reached')
            url = BASE + '?' + urllib.parse.urlencode(dict(symbol=symbol, interval='1m', startTime=cursor, endTime=END-1, limit=1000))
            calls += 1
            with urllib.request.urlopen(url, timeout=25) as response:
                batch = json.load(response)
            if not batch:
                raise RuntimeError(f'Empty data at {cursor}')
            rows.extend([[r[0], *r[1:6]] for r in batch])
            cursor = int(batch[-1][0])+60000
            if calls % 25 == 0:
                print(symbol, calls, 'requests', flush=True)
        pd.DataFrame(rows, columns=['time','open','high','low','close','volume']).to_csv(path,index=False)
    df = pd.read_csv(path)
    expected = np.arange(START, END, 60000)
    if not np.array_equal(df.time.to_numpy(), expected):
        raise RuntimeError(f'{symbol}: duplicate, missing, or out-of-window bars; refusing silent fill')
    for col in ['open','high','low','close','volume']:
        if not np.isfinite(df[col]).all():
            raise RuntimeError('Non-finite market data')
    if not ((df.high >= df[['open','close','low']].max(axis=1)) & (df.low <= df[['open','close','high']].min(axis=1))).all():
        raise RuntimeError('Invalid OHLC')
    return df, dict(path=str(path.relative_to(ROOT)),sha256=sha(path),rows=len(df),requests_this_run=calls,
                    first_utc=pd.to_datetime(df.time.iloc[0],unit='ms',utc=True).isoformat(),
                    last_utc=pd.to_datetime(df.time.iloc[-1],unit='ms',utc=True).isoformat())

def features(df):
    c = df.close
    f = pd.DataFrame(index=df.index)
    for lag in [1,3,5,15,30,60]:
        f[f'return_{lag}'] = c.pct_change(lag)
    f['range'] = (df.high-df.low)/c
    f['body'] = (c-df.open)/c
    for window in [15,60]:
        f[f'volatility_{window}'] = c.pct_change().rolling(window).std()
        f[f'mean_distance_{window}'] = c/c.rolling(window).mean()-1
    f['volume_ratio'] = df.volume/(df.volume.rolling(60).mean()+1e-12)
    minutes = (df.time//60000)%1440
    f['hour_sin'] = np.sin(2*np.pi*minutes/1440)
    f['hour_cos'] = np.cos(2*np.pi*minutes/1440)
    return f

def labels(df, quantity, tp, direction, horizon=H):
    """Signal closes at i; enters i+1 open. All terminal rows require full horizon."""
    n = len(df)
    entry = np.empty(n); entry[:] = np.nan
    entry[:-1] = df.open.to_numpy()[1:]
    pnl = np.full(n,np.nan)
    exits = np.full(n,-1,dtype=int)
    reason = np.full(n,'unresolved',dtype='<U12')
    active = np.arange(n) < n-horizon
    for k in range(1,horizon+1):
        ids = np.flatnonzero(active)
        j = ids+k
        op = (df.open.to_numpy()[j]-entry[ids])*quantity*direction
        favorable = ((df.high if direction==1 else df.low).to_numpy()[j]-entry[ids])*quantity*direction
        adverse = ((df.low if direction==1 else df.high).to_numpy()[j]-entry[ids])*quantity*direction
        sl = adverse <= -tp/2
        hit = favorable >= tp
        # Adverse opening gaps fill at open (worse than stop), favorable gaps capped at target.
        gap_sl = op <= -tp/2
        gap_tp = op >= tp
        stop = gap_sl | (~gap_tp & sl)
        target = ~stop & (gap_tp | hit)
        timeout = ~(stop|target) & (k==horizon)
        done = stop|target|timeout
        selected = ids[done]
        vals = np.where(stop,np.minimum(op,-tp/2),np.where(target,tp,
            (df.close.to_numpy()[j]-entry[ids])*quantity*direction))
        pnl[selected] = vals[done]
        exits[selected] = j[done]
        reason[selected] = np.where(stop,'SL',np.where(target,'TP','timeout'))[done]
        active[selected] = False
    return dict(pnl=pnl,exits=exits,reason=reason,entry=entry)

def segments(n):
    a,b = int(n*.6),int(n*.8)
    return dict(train=np.arange(60,a-H-1),validation=np.arange(a,b-H-1),test=np.arange(b,n-H)), dict(a=a,b=b,purge_bars=H+1)

def trades_for(scores, ids, lab, threshold):
    selected=[]; free=-1
    for i,p in zip(ids,scores):
        # No new signal while the previous position is open, even if it exits intrabar here.
        if i <= free or p < threshold:
            continue
        selected.append(int(i)); free=int(lab['exits'][i])
    return np.array(selected,dtype=int)

def wilson(k,n):
    if not n: return [None,None]
    z=1.959963984540054; p=k/n; d=1+z*z/n
    center=(p+z*z/(2*n))/d
    half=z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [float(center-half),float(center+half)]

def metrics(ids,lab,cost,days,df=None,quantity=None,direction=None):
    net=lab['pnl'][ids]-cost
    n=len(ids); eq=np.r_[0,np.cumsum(net)]
    dd=float(np.max(np.maximum.accumulate(eq)-eq))
    result=dict(n_trades=n,net_wins=int((net>0).sum()),net_win_rate=float((net>0).mean()) if n else None,
        tp_hits=int((lab['reason'][ids]=='TP').sum()),tp_hit_rate=float((lab['reason'][ids]=='TP').mean()) if n else None,
        gross_pnl_usd=float(lab['pnl'][ids].sum()),net_pnl_usd=float(net.sum()),expectancy_usd=float(net.mean()) if n else None,
        realized_max_drawdown_usd=dd,trades_per_day=n/days,net_win_rate_wilson95=wilson(int((net>0).sum()),n),
        tp_hit_rate_wilson95=wilson(int((lab['reason'][ids]=='TP').sum()),n),
        timeout_count=int((lab['reason'][ids]=='timeout').sum()),cost_per_round_trip_usd=cost)
    if df is not None:
        equity=[0.]; realized=0.
        for i in ids:
            end=lab['exits'][i]
            # Mark-to-market at each completed interior minute, and actual exit fill on exit bar.
            for j in range(i+1,end):
                equity.append(realized+(df.close.iloc[j]-lab['entry'][i])*quantity*direction-cost)
            realized+=lab['pnl'][i]-cost
            equity.append(realized)
        e=np.array(equity)
        result['bar_close_mark_to_market_max_drawdown_usd']=float(np.max(np.maximum.accumulate(e)-e))
        result['mtm_limitation']='Minute-close only, excludes intraminute adverse excursions and margin/liquidation.'
    return result

def model_for(name):
    if name=='logistic':
        return make_pipeline(StandardScaler(),LogisticRegression(C=0.1,max_iter=200,random_state=SEED))
    return HistGradientBoostingClassifier(max_iter=60,max_leaf_nodes=7,max_depth=3,learning_rate=.05,l2_regularization=10,
                                         min_samples_leaf=150,early_stopping=False,random_state=SEED)

def research_symbol(symbol,df,meta):
    quantity=1. if symbol=='PAXGUSDT' else .01
    # Spread is a complete round-trip charge, not charged twice. Extra slippage is separate.
    costs=[dict(name='observed_spread_assumption',spread=.24,slippage=.02,commission=0),
           dict(name='wider_session_assumption',spread=.40,slippage=.02,commission=0)] if symbol=='PAXGUSDT' else [
           dict(name='illustrative_base',spread=.20,slippage=.10,commission=0),
           dict(name='illustrative_wide',spread=.50,slippage=.10,commission=0)]
    basecost=sum(costs[0][x] for x in ['spread','slippage','commission'])
    X=features(df); seg,bounds=segments(len(df))
    assert seg['train'][-1]+H < seg['validation'][0]
    assert seg['validation'][-1]+H < seg['test'][0]
    assert np.isfinite(X.iloc[seg['train']]).all().all()
    records=[]; candidates=[]; labs={}
    for tp in [5.,10.]:
        for direction in [1,-1]:
            lab=labels(df,quantity,tp,direction); labs[(tp,direction)]=lab
            y=(lab['reason']=='TP').astype(int)
            for name in ['logistic','hist_gradient_boosting']:
                model=model_for(name)
                model.fit(X.iloc[seg['train']],y[seg['train']])
                scores=model.predict_proba(X.iloc[seg['validation']])[:,1]
                for threshold in THRESHOLDS:
                    ids=trades_for(scores,seg['validation'],lab,threshold)
                    m=metrics(ids,lab,basecost,len(seg['validation'])/1440)
                    rec=dict(tp_usd=tp,sl_usd=tp/2,direction=direction,model=name,threshold=threshold,validation=m,
                             eligible=len(ids)>=30)
                    records.append(rec)
                    if len(ids)>=30:
                        candidates.append((m['net_pnl_usd'],len(records)-1,model,lab))
    # Winner chosen by validation net PnL, not test, with a fixed minimum 30-trade gate.
    if not candidates:
        return dict(data=meta,hypotheses=records,status='no_validation_candidate',cost_scenarios=costs,split=bounds)
    _,index,model,lab=max(candidates,key=lambda t:(t[0],-t[1]))
    chosen=records[index]
    # If no validation edge, preserve research results but explicitly disable deployment.
    scores=model.predict_proba(X.iloc[seg['test']])[:,1]
    ids=trades_for(scores,seg['test'],lab,chosen['threshold'])
    final=[]
    for scenario in costs:
        cost=sum(scenario[x] for x in ['spread','slippage','commission'])
        final.append(dict(scenario=scenario,metrics=metrics(ids,lab,cost,len(seg['test'])/1440,df,quantity,chosen['direction'])))
    trade_df=pd.DataFrame(dict(signal_index=ids,entry_index=ids+1,exit_index=lab['exits'][ids],
        signal_utc=pd.to_datetime(df.time.iloc[ids].to_numpy()+60000,unit='ms',utc=True),
        entry_utc=pd.to_datetime(df.time.iloc[ids+1].to_numpy(),unit='ms',utc=True),
        exit_bar_open_utc=pd.to_datetime(df.time.iloc[lab['exits'][ids]].to_numpy(),unit='ms',utc=True),
        entry_price=lab['entry'][ids],direction=chosen['direction'],gross_pnl_usd=lab['pnl'][ids],
        exit_reason=lab['reason'][ids],model_score=scores[np.searchsorted(seg['test'],ids)]))
    trade_path=OUT/f'{symbol}_test_trades.csv';trade_df.to_csv(trade_path,index=False)
    partitions={key:dict(signal_rows=len(v),first_signal_bar_utc=pd.to_datetime(df.time.iloc[v[0]],unit='ms',utc=True).isoformat(),
                        last_signal_bar_utc=pd.to_datetime(df.time.iloc[v[-1]],unit='ms',utc=True).isoformat(),
                        latest_possible_exit_bar_utc=pd.to_datetime(df.time.iloc[v[-1]+H],unit='ms',utc=True).isoformat()) for key,v in seg.items()}
    return dict(status='executed_not_approved_for_live',data=meta,quantity_assumption=quantity,cost_scenarios=costs,split=bounds,
                partitions=partitions,hypotheses=records,chosen_validation_hypothesis_index=index,chosen=chosen,final_test=final,
                final_test_evaluations=1,trade_log=str(trade_path.relative_to(ROOT)),trade_log_sha256=sha(trade_path),
                positive_validation_pnl=chosen['validation']['net_pnl_usd']>0)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    started=datetime.now(timezone.utc).isoformat()
    with ThreadPoolExecutor(max_workers=2) as pool:
        data=list(pool.map(fetch,['BTCUSDT','PAXGUSDT']))
    result=dict(status='completed',started_utc=started,seed=SEED,script_sha256=sha(Path(__file__)),python=sys.version,
        versions=dict(numpy=np.__version__,pandas=pd.__version__,sklearn=sklearn.__version__),
        fixed_window=dict(start_utc='2026-08-06T00:00:00Z',end_exclusive_utc='2026-11-04T00:00:00Z',days=90),
        source=BASE,methodology=dict(horizon_minutes=H,split='60/20/20 chronological; H+1 bars purged at train and validation ends',
        entry='Next bar open after completed signal candle',labels='Gross TP first vs SL first within 30 minutes; ambiguous same-minute touches SL first; timeout forced close; final full-horizon-unavailable bars dropped',
        gaps='Adverse gap fills at opening price; favorable gaps capped at TP. Opening TP gap precedes subsequent intrabar SL because its order is observable.',
        models='Logistic C=.1; HGB 60 iterations depth 3 leaves 7. Fixed seed. No early-stopping random validation.',
        selection='64 fixed hypotheses per symbol: 2 gross TPs x 2 directions x 2 models x 4 thresholds. Validation max net PnL with >=30 trades; tie first hypothesis. No retraining. Selected policy tested once; same trades repriced for cost stress.',
        predictions='Uncalibrated model scores, NOT calibrated win probabilities.',execution='One position per symbol, no overlapping trades, no signals until strictly after exit bar.',
        costs='Gross levels derived from assumed quantities; fixed scenario spread+slippage deducted from every exit. No broker spread path or bid/ask execution evidence.'),
        warnings=['PAXGUSDT is exchange-traded gold token, not broker XAUUSDm; BTCUSDT spot is not broker BTCUSD. Proxy results do not establish broker performance.',
        'XAU .01 lot = 1 oz and BTC .01 lot = .01 BTC are UNCONFIRMED contract assumptions; USDT is treated as USD without FX/depeg modeling.',
        'XAU spread .24 based only on user screenshot around 2026-11-04 16:00 server time (Bid 4048.435 Ask 4048.675); .40 wider assumption; commission zero from user; .02 slippage invented scenario, not observed.',
        'BTC spread .20/.50 and .10 slippage are USD PnL cost assumptions, not quotes. Commission zero is an unverified BTC scenario.',
        'Wilson 95% intervals assume independent trades; sequential samples are dependent and selection/multiple testing increases uncertainty. Intervals are descriptive, likely too narrow.',
        '85% is a desired target, never a guarantee. No test optimization or reruns to improve outcomes. High hit rate alone is insufficient.',
        'No MT5 tick data, broker contract verification, financing, execution latency, partial fills, margin or liquidation simulation. Spread is an additive approximation, not bid/ask replay.',
        'Fixed 90-day window selected before market-data inspection. No prior flawed script conclusions used.'],symbols={})
    for symbol,(df,meta) in zip(['BTCUSDT','PAXGUSDT'],data):
        print('Fitting',symbol,flush=True)
        result['symbols'][symbol]=research_symbol(symbol,df,meta)
    result['finished_utc']=datetime.now(timezone.utc).isoformat()
    result['conclusion']='Research only. No claim of achieving 85% or broker profitability; inspect out-of-sample evidence and collect verified broker ticks/contracts before further evaluation.'
    (OUT/'evidence.json').write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    lines=['# Bounded ML scalping evidence','',f'Executed: {started} to {result["finished_utc"]}.','',
        '**Not a live-trading approval. PAXG is NOT broker XAUUSDm evidence.**','',
        '90 days, 2026-08-06 00:00 UTC through 2026-11-04 00:00 UTC exclusive. Gross RR 1:2; TP $5/$10, SL $2.50/$5. Assumed lot .01, quantity 1 oz gold or .01 BTC. Contract sizes unconfirmed.','',
        '## Final untouched test','', '| Proxy | Chosen model / TP / side / score threshold | Cost | Trades | Net win % | TP % | Net PnL $ | Expectancy $ | Realized DD $ | Close MTM DD $ | Trades/day |',
        '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for symbol,s in result['symbols'].items():
        c=s.get('chosen')
        if not c: lines.append(f'{symbol}: {s["status"]}');continue
        for row in s['final_test']:
            m=row['metrics'];cost=m['cost_per_round_trip_usd']
            wr='n/a' if m['net_win_rate'] is None else f'{100*m["net_win_rate"]:.2f}'
            tp='n/a' if m['tp_hit_rate'] is None else f'{100*m["tp_hit_rate"]:.2f}'
            exp='n/a' if m['expectancy_usd'] is None else f'{m["expectancy_usd"]:.3f}'
            lines.append(f'| {symbol} | {c["model"]} / {c["tp_usd"]} / {c["direction"]} / {c["threshold"]} | {cost:.2f} | {m["n_trades"]} | {wr} | {tp} | {m["net_pnl_usd"]:.2f} | {exp} | {m["realized_max_drawdown_usd"]:.2f} | {m["bar_close_mark_to_market_max_drawdown_usd"]:.2f} | {m["trades_per_day"]:.2f} |')
        lines += ['',f'### {symbol}',f'- Validation winner index {s["chosen_validation_hypothesis_index"]}; validation net PnL ${c["validation"]["net_pnl_usd"]:.2f}, {c["validation"]["n_trades"]} trades.',
                  f'- Test base-cost net-win Wilson 95% interval: {s["final_test"][0]["metrics"]["net_win_rate_wilson95"]}. TP interval: {s["final_test"][0]["metrics"]["tp_hit_rate_wilson95"]}.',
                  f'- Cache SHA256: `{s["data"]["sha256"]}`. Rows: {s["data"]["rows"]}; network requests this run: {s["data"]["requests_this_run"]}.',
                  f'- Trade log: `{s["trade_log"]}`; SHA256 `{s["trade_log_sha256"]}`.',
                  '- Exact split dates, all 64 hypotheses and metrics are preserved in evidence.json.']
    lines+=['','## Methodology']+[f'- **{k}:** {v}' for k,v in result['methodology'].items()]
    lines+=['','## Costs and limitations']+['- '+s for s in result['warnings']]
    lines+=['','## Reproduction','',r'From project root: `C:\Users\rdhan\AppData\Local\Temp\opencode\mlvenv\Scripts\python.exe research\test_research.py` then the same interpreter with `research\run_ml.py`.',
            'Dependencies pinned in research/requirements.txt. Existing exact-window cache is reused; missing/corrupt/gapped data fails closed. Maximum 270 kline requests (135 per symbol); no retry loop. Public endpoint only, no credentials, orders, commits or pushes.',
            f'Script SHA256: `{result["script_sha256"]}`. Seed {SEED}. Python {platform.python_version()}; numpy {np.__version__}, pandas {pd.__version__}, sklearn {sklearn.__version__}.',
            '',result['conclusion']]
    (OUT/'evidence.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines[:18]),flush=True)

if __name__=='__main__':
    try: main()
    except Exception:
        OUT.mkdir(parents=True,exist_ok=True)
        failure=dict(status='failed',time_utc=datetime.now(timezone.utc).isoformat(),error=traceback.format_exc())
        (OUT/'failure.json').write_text(json.dumps(failure,indent=2),encoding='utf-8')
        (OUT/'failure.md').write_text('# Research failed\n\n```\n'+failure['error']+'\n```\nNo results fabricated.\n',encoding='utf-8')
        raise
