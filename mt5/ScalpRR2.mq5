//+------------------------------------------------------------------+
//| ScalpRR2.mq5                                                      |
//| Asisten scalping XAUUSD / BTCUSD: TP & SL dalam DOLAR (RR 1:2).   |
//|                                                                   |
//| PENTING                                                           |
//| - Default = MODE SINYAL SAJA (InpAutoTrade=false): EA hanya       |
//|   mengirim notifikasi ke MT5 di HP & menggambar level. Tidak ada  |
//|   order yang dibuka.                                              |
//| - EA tidak bisa berjalan di aplikasi MT5 Android/iOS. Jalankan di |
//|   MT5 desktop (PC/VPS); notifikasi & posisinya muncul di HP.      |
//| - Uji di akun DEMO + Strategy Tester (mode "Every tick based on   |
//|   real ticks") sebelum memakai uang sungguhan.                    |
//| - Backtest riset (Binance, tanpa data broker) TIDAK menemukan     |
//|   aturan dengan win rate 85% pada RR 1:2. Lihat research/README.  |
//+------------------------------------------------------------------+
#property copyright "Chart Analysis Dashboard"
#property version   "1.00"
#property strict
#property description "Sinyal scalping RR 1:2 dengan TP/SL dalam dolar. Default: sinyal saja."

#include <Trade/Trade.mqh>

enum ENUM_SETUP
  {
   SETUP_TREND_PULLBACK = 0, // Trend pullback (EMA20/50 + RSI kembali dari 40/60)
   SETUP_LIQ_SWEEP      = 1  // Liquidity sweep swing (SMC) searah EMA200
  };

//--- Input
input group "Mode"
input bool            InpAutoTrade      = false;               // Eksekusi otomatis (false = sinyal saja)
input bool            InpPush           = true;                // Kirim notifikasi ke MT5 di HP
input bool            InpDrawLevels     = true;                // Gambar Entry/SL/TP di chart
input group "Setup"
input ENUM_SETUP      InpSetup          = SETUP_TREND_PULLBACK;
input ENUM_TIMEFRAMES InpSignalTF       = PERIOD_M15;          // Timeframe sinyal (candle tertutup)
input double          InpRsiLong        = 40.0;                // RSI naik melewati level ini (long)
input double          InpRsiShort       = 60.0;                // RSI turun melewati level ini (short)
input group "Risiko (dolar per posisi)"
input double          InpLots           = 0.01;                // Lot (dibatasi InpMaxLots)
input double          InpMaxLots        = 0.01;                // Batas lot maksimum
input double          InpTakeProfitUSD  = 10.0;                // Target profit kotor ($)
input double          InpStopLossUSD    = 5.0;                 // Batas rugi kotor ($) -> RR 1:2
input double          InpMaxSpreadUSD   = 0.50;                // Lewati sinyal bila spread > ini ($ pada lot di atas)
input group "Rem harian"
input double          InpDailyLossUSD   = 25.0;                // Stop trading hari ini bila rugi >= ini ($)
input int             InpMaxTradesDay   = 20;                  // Maksimum entry per hari
input int             InpMaxConsecLoss  = 5;                   // Stop hari ini setelah N kalah beruntun
input bool            InpSessionFilter  = true;                // Hanya jam London + New York
input int             InpSessionStartUTC = 7;                  // Jam mulai (UTC)
input int             InpSessionEndUTC   = 17;                 // Jam selesai (UTC)
input long            InpMagic          = 2026110501;

CTrade   trade;
int      hEma20 = INVALID_HANDLE, hEma50 = INVALID_HANDLE, hEma200 = INVALID_HANDLE, hRsi = INVALID_HANDLE;
datetime lastBarTime = 0;
int      dayTrades = 0, consecLoss = 0, dayKey = -1;
double   dayPnl = 0.0;
datetime lastDealCheck = 0;

//+------------------------------------------------------------------+
//| Nilai uang per 1.0 pergerakan harga untuk lot tertentu.          |
//| Dihitung dari spesifikasi simbol broker (tick value/size), jadi  |
//| otomatis benar untuk XAUUSDm, BTCUSDm, XAUUSD.v, dsb.             |
//+------------------------------------------------------------------+
double MoneyPerPriceUnit(const double lots)
  {
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0.0) tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   const double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickValue <= 0.0 || tickSize <= 0.0) return 0.0;
   return tickValue / tickSize * lots;
  }

double NormalizeLots(double lots)
  {
   const double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   const double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   const double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lots = MathMin(lots, InpMaxLots);
   if(step > 0.0) lots = MathFloor(lots / step + 1e-9) * step;
   lots = MathMax(vmin, MathMin(vmax, lots));
   return NormalizeDouble(lots, 2);
  }

bool ReadBuffer(const int handle, const int shift, double &value)
  {
   double buf[1];
   if(CopyBuffer(handle, 0, shift, 1, buf) != 1) return false;
   value = buf[0];
   return true;
  }

int TodayKey()
  {
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   return t.year * 1000 + t.day_of_year;
  }

bool InSession()
  {
   if(!InpSessionFilter) return true;
   MqlDateTime t;
   TimeToStruct(TimeGMT(), t);
   return t.hour >= InpSessionStartUTC && t.hour < InpSessionEndUTC;
  }

bool HasOpenPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(PositionGetTicket(i) == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

//--- Rekap hasil deal milik EA hari ini (rem harian & kalah beruntun).
void RefreshDayStats()
  {
   const int key = TodayKey();
   if(key != dayKey)
     {
      dayKey = key; dayTrades = 0; dayPnl = 0.0; consecLoss = 0;
     }
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   t.hour = 0; t.min = 0; t.sec = 0;
   const datetime dayStart = StructToTime(t);
   if(!HistorySelect(dayStart, TimeCurrent() + 60)) return;
   double pnl = 0.0; int entries = 0, streak = 0;
   const int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic) continue;
      const long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN) { entries++; continue; }
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
      const double p = HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_COMMISSION);
      pnl += p;
      streak = p < 0.0 ? streak + 1 : 0;
     }
   dayPnl = pnl; dayTrades = entries; consecLoss = streak;
  }

string BrakeReason()
  {
   if(dayPnl <= -MathAbs(InpDailyLossUSD)) return StringFormat("rugi hari ini $%.2f >= batas $%.2f", -dayPnl, InpDailyLossUSD);
   if(dayTrades >= InpMaxTradesDay) return StringFormat("sudah %d entry hari ini (maks %d)", dayTrades, InpMaxTradesDay);
   if(consecLoss >= InpMaxConsecLoss) return StringFormat("%d kali kalah beruntun (maks %d)", consecLoss, InpMaxConsecLoss);
   return "";
  }

//--- Sinyal dari candle TERTUTUP (shift 1 & 2): +1 long, -1 short, 0 tidak ada.
int SignalOnClosedBar()
  {
   double e20, e50, e200, rsi1, rsi2;
   if(!ReadBuffer(hEma20, 1, e20) || !ReadBuffer(hEma50, 1, e50) || !ReadBuffer(hEma200, 1, e200)) return 0;
   if(!ReadBuffer(hRsi, 1, rsi1) || !ReadBuffer(hRsi, 2, rsi2)) return 0;
   const double close1 = iClose(_Symbol, InpSignalTF, 1);
   if(close1 <= 0.0) return 0;

   if(InpSetup == SETUP_TREND_PULLBACK)
     {
      if(e20 > e50 && close1 > e200 && rsi2 < InpRsiLong && rsi1 >= InpRsiLong) return 1;
      if(e20 < e50 && close1 < e200 && rsi2 > InpRsiShort && rsi1 <= InpRsiShort) return -1;
      return 0;
     }

   // Liquidity sweep: candle 1 menembus swing low/high terakhir lalu close kembali ke dalam.
   const int L = 2, lookback = 60;
   double swingLow = 0.0, swingHigh = 0.0;
   for(int k = 1 + L + 1; k < lookback && (swingLow == 0.0 || swingHigh == 0.0); k++)
     {
      bool isLow = true, isHigh = true;
      const double lk = iLow(_Symbol, InpSignalTF, k), hk = iHigh(_Symbol, InpSignalTF, k);
      for(int j = k - L; j <= k + L; j++)
        {
         if(j == k) continue;
         if(iLow(_Symbol, InpSignalTF, j) <= lk) isLow = false;
         if(iHigh(_Symbol, InpSignalTF, j) >= hk) isHigh = false;
        }
      if(isLow && swingLow == 0.0) swingLow = lk;
      if(isHigh && swingHigh == 0.0) swingHigh = hk;
     }
   const double low1 = iLow(_Symbol, InpSignalTF, 1), high1 = iHigh(_Symbol, InpSignalTF, 1);
   if(swingLow > 0.0 && close1 > e200 && low1 < swingLow && close1 > swingLow) return 1;
   if(swingHigh > 0.0 && close1 < e200 && high1 > swingHigh && close1 < swingHigh) return -1;
   return 0;
  }

void DrawLevel(const string name, const double price, const color clr)
  {
   if(!InpDrawLevels) return;
   const string obj = "SRR2_" + name;
   if(ObjectFind(0, obj) < 0) ObjectCreate(0, obj, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, obj, OBJPROP_PRICE, price);
   ObjectSetInteger(0, obj, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, obj, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetString(0, obj, OBJPROP_TEXT, name + " " + DoubleToString(price, _Digits));
  }

void Notify(const string text)
  {
   Print(text);
   if(!InpPush) return;
   if(!TerminalInfoInteger(TERMINAL_NOTIFICATIONS_ENABLED))
     {
      Print("Notifikasi HP belum aktif: Tools > Options > Notifications, isi MetaQuotes ID dari aplikasi MT5 di HP.");
      return;
     }
   ResetLastError();
   if(!SendNotification(StringSubstr(text, 0, 255)))
      Print("SendNotification gagal, error ", GetLastError());
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpTakeProfitUSD <= 0.0 || InpStopLossUSD <= 0.0)
     {
      Print("TP dan SL ($) harus > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpLots > InpMaxLots)
      Print("InpLots lebih besar dari InpMaxLots; lot dibatasi ke ", DoubleToString(InpMaxLots, 2));
   hEma20  = iMA(_Symbol, InpSignalTF, 20, 0, MODE_EMA, PRICE_CLOSE);
   hEma50  = iMA(_Symbol, InpSignalTF, 50, 0, MODE_EMA, PRICE_CLOSE);
   hEma200 = iMA(_Symbol, InpSignalTF, 200, 0, MODE_EMA, PRICE_CLOSE);
   hRsi    = iRSI(_Symbol, InpSignalTF, 14, PRICE_CLOSE);
   if(hEma20 == INVALID_HANDLE || hEma50 == INVALID_HANDLE || hEma200 == INVALID_HANDLE || hRsi == INVALID_HANDLE)
     {
      Print("Gagal membuat indikator.");
      return INIT_FAILED;
     }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   const double lots = NormalizeLots(InpLots);
   const double mpu = MoneyPerPriceUnit(lots);
   PrintFormat("ScalpRR2 %s | mode=%s | lot=%.2f | $ per 1.0 harga=%.4f | TP $%.2f = %.*f harga | SL $%.2f = %.*f harga",
               _Symbol, InpAutoTrade ? "AUTO-TRADE" : "SINYAL SAJA", lots, mpu,
               InpTakeProfitUSD, _Digits, mpu > 0 ? InpTakeProfitUSD / mpu : 0.0,
               InpStopLossUSD, _Digits, mpu > 0 ? InpStopLossUSD / mpu : 0.0);
   lastBarTime = iTime(_Symbol, InpSignalTF, 0); // jangan menembak sinyal lama saat EA baru dipasang
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   IndicatorRelease(hEma20); IndicatorRelease(hEma50); IndicatorRelease(hEma200); IndicatorRelease(hRsi);
   ObjectsDeleteAll(0, "SRR2_");
  }

void OnTick()
  {
   const datetime barTime = iTime(_Symbol, InpSignalTF, 0);
   if(barTime == 0 || barTime == lastBarTime) return; // hanya sekali per candle baru
   lastBarTime = barTime;

   RefreshDayStats();
   const int dir = SignalOnClosedBar();
   if(dir == 0) return;

   const string side = dir > 0 ? "BUY" : "SELL";
   const string brake = BrakeReason();
   if(brake != "") { Print("Sinyal ", side, " dilewati: ", brake); return; }
   if(!InSession()) { Print("Sinyal ", side, " dilewati: di luar jam sesi."); return; }
   if(HasOpenPosition()) { Print("Sinyal ", side, " dilewati: masih ada posisi EA terbuka."); return; }

   const double lots = NormalizeLots(InpLots);
   const double mpu = MoneyPerPriceUnit(lots);
   if(mpu <= 0.0) { Print("Spesifikasi simbol tidak lengkap (tick value/size)."); return; }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;
   const double spreadUSD = (tick.ask - tick.bid) * mpu;
   if(spreadUSD > InpMaxSpreadUSD)
     {
      PrintFormat("Sinyal %s dilewati: spread $%.2f > batas $%.2f", side, spreadUSD, InpMaxSpreadUSD);
      return;
     }

   const double entry = dir > 0 ? tick.ask : tick.bid;
   const double tpDist = InpTakeProfitUSD / mpu, slDist = InpStopLossUSD / mpu;
   const double stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(slDist <= stopsLevel || tpDist <= stopsLevel)
     {
      PrintFormat("Sinyal %s dilewati: jarak SL/TP lebih kecil dari stop level broker (%.*f).", side, _Digits, stopsLevel);
      return;
     }
   const double sl = NormalizeDouble(dir > 0 ? entry - slDist : entry + slDist, _Digits);
   const double tp = NormalizeDouble(dir > 0 ? entry + tpDist : entry - tpDist, _Digits);

   DrawLevel("Entry", entry, clrGold);
   DrawLevel("SL", sl, clrRed);
   DrawLevel("TP", tp, clrLime);

   const string msg = StringFormat("%s %s %s %.2f lot @%.*f SL %.*f TP %.*f (TP $%.0f / SL $%.0f, spread $%.2f) %s",
                                   _Symbol, EnumToString(InpSignalTF), side, lots, _Digits, entry, _Digits, sl, _Digits, tp,
                                   InpTakeProfitUSD, InpStopLossUSD, spreadUSD, InpAutoTrade ? "[AUTO]" : "[SINYAL]");
   if(!InpAutoTrade) { Notify(msg); return; }

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
     {
      Notify(msg + " - Algo Trading tidak aktif, order tidak dikirim.");
      return;
     }
   const bool ok = dir > 0 ? trade.Buy(lots, _Symbol, 0.0, sl, tp, "ScalpRR2") : trade.Sell(lots, _Symbol, 0.0, sl, tp, "ScalpRR2");
   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE || trade.ResultRetcode() == TRADE_RETCODE_PLACED))
      Notify(msg + StringFormat(" - order #%I64u", trade.ResultOrder()));
   else
      Notify(msg + StringFormat(" - ORDER GAGAL retcode %u %s", trade.ResultRetcode(), trade.ResultRetcodeDescription()));
  }
//+------------------------------------------------------------------+
