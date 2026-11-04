# Bounded ML scalping evidence

Executed: 2026-11-04T16:42:06.416378+00:00 to 2026-11-04T16:44:02.499037+00:00.

**Not a live-trading approval. PAXG is NOT broker XAUUSDm evidence.**

90 days, 2026-08-06 00:00 UTC through 2026-11-04 00:00 UTC exclusive. Gross RR 1:2; TP $5/$10, SL $2.50/$5. Assumed lot .01, quantity 1 oz gold or .01 BTC. Contract sizes unconfirmed.

## Final untouched test

| Proxy | Chosen model / TP / side / score threshold | Cost | Trades | Net win % | TP % | Net PnL $ | Expectancy $ | Realized DD $ | Close MTM DD $ | Trades/day |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
BTCUSDT: no_validation_candidate
| PAXGUSDT | logistic / 10.0 / -1 / 0.4 | 0.26 | 33 | 27.27 | 27.27 | -39.09 | -1.185 | 64.68 | 67.51 | 1.84 |
| PAXGUSDT | logistic / 10.0 / -1 / 0.4 | 0.42 | 33 | 27.27 | 27.27 | -44.37 | -1.345 | 67.56 | 70.55 | 1.84 |

### PAXGUSDT
- Validation winner index 24; validation net PnL $36.47, 39 trades.
- Test base-cost net-win Wilson 95% interval: [0.1506744088542064, 0.44217559002872625]. TP interval: [0.1506744088542064, 0.44217559002872625].
- Cache SHA256: `4d731778f6015ec8f74485b9f4d13e9124d073db3b0f9b2a3a0d4761372d7b2d`. Rows: 129600; network requests this run: 130.
- Trade log: `results\PAXGUSDT_test_trades.csv`; SHA256 `2e51e713df4bfed314de7496109cb15da1695b83ed42e32cad65aca4d0a7714c`.
- Exact split dates, all 64 hypotheses and metrics are preserved in evidence.json.

## Methodology
- **horizon_minutes:** 30
- **split:** 60/20/20 chronological; H+1 bars purged at train and validation ends
- **entry:** Next bar open after completed signal candle
- **labels:** Gross TP first vs SL first within 30 minutes; ambiguous same-minute touches SL first; timeout forced close; final full-horizon-unavailable bars dropped
- **gaps:** Adverse gap fills at opening price; favorable gaps capped at TP. Opening TP gap precedes subsequent intrabar SL because its order is observable.
- **models:** Logistic C=.1; HGB 60 iterations depth 3 leaves 7. Fixed seed. No early-stopping random validation.
- **selection:** 64 fixed hypotheses per symbol: 2 gross TPs x 2 directions x 2 models x 4 thresholds. Validation max net PnL with >=30 trades; tie first hypothesis. No retraining. Selected policy tested once; same trades repriced for cost stress.
- **predictions:** Uncalibrated model scores, NOT calibrated win probabilities.
- **execution:** One position per symbol, no overlapping trades, no signals until strictly after exit bar.
- **costs:** Gross levels derived from assumed quantities; fixed scenario spread+slippage deducted from every exit. No broker spread path or bid/ask execution evidence.

## Costs and limitations
- PAXGUSDT is exchange-traded gold token, not broker XAUUSDm; BTCUSDT spot is not broker BTCUSD. Proxy results do not establish broker performance.
- XAU .01 lot = 1 oz and BTC .01 lot = .01 BTC are UNCONFIRMED contract assumptions; USDT is treated as USD without FX/depeg modeling.
- XAU spread .24 based only on user screenshot around 2026-11-04 16:00 server time (Bid 4048.435 Ask 4048.675); .40 wider assumption; commission zero from user; .02 slippage invented scenario, not observed.
- BTC spread .20/.50 and .10 slippage are USD PnL cost assumptions, not quotes. Commission zero is an unverified BTC scenario.
- Wilson 95% intervals assume independent trades; sequential samples are dependent and selection/multiple testing increases uncertainty. Intervals are descriptive, likely too narrow.
- 85% is a desired target, never a guarantee. No test optimization or reruns to improve outcomes. High hit rate alone is insufficient.
- No MT5 tick data, broker contract verification, financing, execution latency, partial fills, margin or liquidation simulation. Spread is an additive approximation, not bid/ask replay.
- Fixed 90-day window selected before market-data inspection. No prior flawed script conclusions used.

## Reproduction

From project root: `C:\Users\rdhan\AppData\Local\Temp\opencode\mlvenv\Scripts\python.exe research\test_research.py` then the same interpreter with `research\run_ml.py`.
Dependencies pinned in research/requirements.txt. Existing exact-window cache is reused; missing/corrupt/gapped data fails closed. Maximum 270 kline requests (135 per symbol); no retry loop. Public endpoint only, no credentials, orders, commits or pushes.
Script SHA256: `dd5dcd181543b45daecdceeed21e953428550fcbc0477c23714cc8ed64fa65aa`. Seed 271828. Python 3.12.10; numpy 2.1.3, pandas 2.2.3, sklearn 1.5.2.

Research only. No claim of achieving 85% or broker profitability; inspect out-of-sample evidence and collect verified broker ticks/contracts before further evaluation.
