import unittest
import numpy as np
import pandas as pd
import run_ml as r


def bars(opens, highs, lows, closes):
    n = len(opens)
    return pd.DataFrame(dict(time=np.arange(n) * 60000, open=opens, high=highs, low=lows, close=closes, volume=np.ones(n)))


class ResearchTests(unittest.TestCase):
    def test_entry_is_next_open_and_tp(self):
        df = bars([100, 101, 101, 101], [100, 101, 106.5, 101], [100, 101, 100, 101], [100, 101, 106, 101])
        lab = r.labels(df, 1, 5, 1, horizon=2)
        self.assertEqual(lab['entry'][0], 101)
        self.assertEqual(lab['reason'][0], 'TP')
        self.assertEqual(lab['exits'][0], 2)
        self.assertEqual(lab['pnl'][0], 5)

    def test_same_bar_touch_is_stop_first(self):
        df = bars([100, 100, 100], [100, 106, 100], [100, 97, 100], [100, 100, 100])
        lab = r.labels(df, 1, 5, 1, horizon=1)
        self.assertEqual(lab['reason'][0], 'SL')
        self.assertEqual(lab['pnl'][0], -2.5)

    def test_adverse_gap_fills_at_open(self):
        df = bars([100, 100, 96, 96], [100, 100, 97, 96], [100, 99, 95, 96], [100, 100, 96, 96])
        lab = r.labels(df, 1, 5, 1, horizon=2)
        self.assertEqual(lab['reason'][0], 'SL')
        self.assertEqual(lab['pnl'][0], -4)

    def test_timeout_and_unresolved_tail(self):
        df = bars([100, 100, 101, 102], [100, 101, 102, 102], [100, 99, 100, 102], [100, 101, 101, 102])
        lab = r.labels(df, 1, 5, 1, horizon=2)
        self.assertEqual(lab['reason'][0], 'timeout')
        self.assertEqual(lab['pnl'][0], 1)
        self.assertTrue(np.all(lab['reason'][-2:] == 'unresolved'))

    def test_features_are_causal(self):
        df = bars(*[np.arange(1, 201, dtype=float)] * 4)
        base = r.features(df).iloc[:150]
        changed = df.copy()
        changed.loc[151:, ['open', 'high', 'low', 'close', 'volume']] *= 10
        pd.testing.assert_frame_equal(base, r.features(changed).iloc[:150])

    def test_purged_partition_exits_do_not_cross(self):
        seg, bounds = r.segments(10000)
        self.assertLess(seg['train'][-1] + r.H, seg['validation'][0])
        self.assertLess(seg['validation'][-1] + r.H, seg['test'][0])
        self.assertLessEqual(seg['test'][-1] + r.H, 9999)

    def test_one_position_without_overlap(self):
        lab = dict(exits=np.array([3, 4, 5, 6, 7, 8]))
        trades = r.trades_for(np.ones(6), np.arange(6), lab, .5)
        self.assertEqual(trades.tolist(), [0, 4])


if __name__ == '__main__':
    unittest.main()
