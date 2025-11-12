import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TradeFlash UI – React Tabbed Client (with conId→Symbol mapping)
 * -----------------------------------------------------------------
 * - Connects to a Flow WS server (DEFAULT_WS)
 * - Builds a live map from IB conId → human symbol using broadcasted
 *   { type:"CONID_MAPPING", conid, mapping:{ symbol, type?, right?, strike?, expiry? } }
 *   and shows the resolved label in Quotes (and optionally elsewhere).
 * - Still supports Stream / Trades / Prints / Quotes tabs, filters, etc.
 */

const DEFAULT_WS = "ws://localhost:3000/ws";
const MAX_ROWS = 500; // cap arrays to avoid memory bloat

/* ======================= UI Bits ======================= */
const Badge: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = "slate" }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-${color}-800/20 text-${color}-300 border border-${color}-700/30`}>
    {children}
  </span>
);

const Tag: React.FC<{ t: string }> = ({ t }) => {
  const map: Record<string, string> = {
    SWEEP: "rose",
    BLOCK: "amber",
    NOTABLE: "emerald",
    REGULAR: "slate",
    BTO: "emerald",
    STO: "amber",
    BTC: "sky",
    STC: "violet",
  };
  const color = map[t] || "slate";
  return <Badge color={color}>{t}</Badge>;
};

const DirPill: React.FC<{ dir?: string }> = ({ dir }) => {
  const color = dir === "BTO" || dir === "BTC" ? "emerald" : "amber";
  return <Badge color={color}>{dir || "-"}</Badge>;
};

function ts(t?: number | string) {
  if (!t) return "";
  try {
    const v = typeof t === "string" && /\d{4}-\d{2}-\d{2}T/.test(t) ? new Date(t).getTime() : Number(t);
    return new Date(v).toLocaleTimeString();
  } catch {
    return "";
  }
}

function num(x: any, d = 2) {
  const n = Number(x);
  if (!isFinite(n)) return "-";
  return n.toFixed(d);
}

/* ======================= WS Hook ======================= */
function useWebSocket(url: string) {
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected" | "error">("disconnected");
  const [lastMsg, setLastMsg] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = React.useCallback((customUrl?: string) => {
    const u = customUrl || url;
    try { wsRef.current?.close(); } catch {}
    setStatus("connecting");
    const ws = new WebSocket(u);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (evt) => {
      try { setLastMsg(JSON.parse(evt.data)); } catch {}
    };
  }, [url]);

  const disconnect = React.useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    setStatus("disconnected");
  }, []);

  const send = React.useCallback((obj: any) => {
    const s = JSON.stringify(obj);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(s);
      return true;
    }
    return false;
  }, []);

  return { status, lastMsg, connect, disconnect, send };
}

/* ================= conId→Symbol Mapping ================= */
export type Mapping = {
  symbol: string;            // "/ES" or "SPY"
  type?: "UNDERLYING" | string;
  right?: "C" | "P" | string;
  strike?: number;
  expiry?: string;           // yyyymmdd
  discoveredAt?: number;
  lastSeen?: number;
};

function labelFromMapping(m?: Mapping): string | undefined {
  if (!m) return undefined;
  if (m.type === "UNDERLYING") return m.symbol;
  const parts = [m.symbol];
  if (m.expiry) parts.push(m.expiry);
  if (m.right) parts.push(m.right);
  if (m.strike != null) parts.push(String(m.strike));
  return parts.join(" ");
}

function useConidMapping(lastMsg: any) {
  // Use object not Map to keep setState simple
  const [mapState, setMapState] = useState<Record<string | number, Mapping>>({});

  useEffect(() => {
    if (!lastMsg) return;

    if (lastMsg.type === "CONID_MAPPING" && lastMsg.conid != null && lastMsg.mapping) {
      setMapState((cur) => ({ ...cur, [lastMsg.conid]: lastMsg.mapping as Mapping }));
    }

    // Optional: If server sometimes embeds mapping inside quotes/trades, harvest here as well.
    if ((lastMsg.type === "LIVE_QUOTE" || lastMsg.type === "UL_LIVE_QUOTE") && lastMsg.mapping && lastMsg.conid) {
      setMapState((cur) => ({ ...cur, [lastMsg.conid]: lastMsg.mapping as Mapping }));
    }
  }, [lastMsg]);

  const resolve = React.useCallback((conid?: string | number) => (conid != null ? mapState[conid] : undefined), [mapState]);

  return { conidMap: mapState, resolve };
}

/* ======================= Data Buckets ======================= */
function useStreamBuckets(lastMsg: any, paused: boolean) {
  const [trades, setTrades] = useState<any[]>([]);
  const [prints, setPrints] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [welcome, setWelcome] = useState<any>(null);
  const [avail, setAvail] = useState<{ futures: string[]; equities: string[] }>({ futures: [], equities: [] });

  useEffect(() => {
    if (!lastMsg || paused) return;

    if (lastMsg.type === "connected") {
      setWelcome(lastMsg);
      setAvail({ futures: lastMsg.availableFutures, equities: lastMsg.availableEquities });
      return;
    }

    if (lastMsg.type === "TRADE" || lastMsg.type === "PUT" || lastMsg.type === "CALL") {
      setTrades((arr) => [lastMsg, ...arr].slice(0, MAX_ROWS));
      return;
    }
    if (lastMsg.type === "PRINT") {
      setPrints((arr) => [lastMsg, ...arr].slice(0, MAX_ROWS));
      return;
    }
    if (lastMsg.type === "LIVE_QUOTE" || lastMsg.type === "UL_LIVE_QUOTE") {
      setQuotes((arr) => [lastMsg, ...arr].slice(0, MAX_ROWS));
      return;
    }
  }, [lastMsg, paused]);

  return { trades, prints, quotes, welcome, avail };
}

/* ======================= Controls ======================= */
function Toolbar({ wsUrl, setWsUrl, status, onConnect, onDisconnect }: any) {
  const dot = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-400",
    error: "bg-rose-500",
    disconnected: "bg-slate-500",
  }[status] || "bg-slate-500";

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-800/60 bg-slate-900/60">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-slate-300 text-sm">{status}</span>
      </div>
      <input
        className="flex-1 min-w-[260px] bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100"
        value={wsUrl}
        onChange={(e) => setWsUrl(e.target.value)}
      />
      <button className="px-3 py-2 rounded bg-emerald-700 text-emerald-50 hover:bg-emerald-600" onClick={() => onConnect(wsUrl)}>Connect</button>
      <button className="px-3 py-2 rounded bg-slate-700 text-slate-50 hover:bg-slate-600" onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

function Subs({ send, avail }: any) {
  const [futs, setFuts] = useState<string[]>(["/ES", "/NQ"]);
  const [eqs, setEqs] = useState<string[]>(["SPY", "QQQ"]);

  const toggle = (list: string[], setList: (fn: any) => void, v: string) => {
    setList((cur: string[]) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat(v)));
  };
  const doSend = () => send({ action: "subscribe", futuresSymbols: futs, equitySymbols: eqs });

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Futures:</span>
        <div className="flex gap-2 flex-wrap">
          {(avail?.futures || ["/ES", "/NQ", "/YM", "/RTY", "/CL", "/GC"]).map((f: string) => (
            <button key={f} onClick={() => toggle(futs, setFuts, f)} className={`px-2 py-1 rounded border text-sm ${futs.includes(f) ? "bg-cyan-800/30 border-cyan-600 text-cyan-200" : "bg-slate-800/40 border-slate-700 text-slate-300"}`}>{f}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Equities:</span>
        <div className="flex gap-2 flex-wrap">
          {(avail?.equities || ["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "AMZN", "MSFT", "META", "GOOGL"]).map((s: string) => (
            <button key={s} onClick={() => toggle(eqs, setEqs, s)} className={`px-2 py-1 rounded border text-sm ${eqs.includes(s) ? "bg-fuchsia-800/30 border-fuchsia-600 text-fuchsia-200" : "bg-slate-800/40 border-slate-700 text-slate-300"}`}>{s}</button>
          ))}
        </div>
      </div>
      <button onClick={doSend} className="ml-auto px-3 py-2 rounded bg-indigo-700 text-indigo-50 hover:bg-indigo-600">Subscribe</button>
    </div>
  );
}

function Tabs({ tabs, active, onTab }: any) {
  return (
    <div className="border-b border-slate-800/60 bg-slate-900/40">
      <div className="flex gap-1 p-2 overflow-x-auto">
        {tabs.map((t: any) => (
          <button key={t.key} onClick={() => onTab(t.key)} className={`px-3 py-2 rounded-t ${active === t.key ? "bg-slate-800 text-white" : "text-slate-300 hover:text-white"}`}>
            {t.label}
            {t.count != null && <span className="ml-2 text-xs text-slate-400">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ======================= Rows ======================= */
function RowTrade({ d }: { d: any }) {
  return (
    <div className="p-3 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <DirPill dir={d.direction} />
        {(d.classifications || []).map((t: string) => (
          <Tag key={t} t={t} />
        ))}
        <span className="text-slate-400 text-xs">{ts(d.timestamp)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-200">
        <span className="font-semibold">{d.symbol} {d.type} ${d.strike}</span>
        <span>exp {d.expiry || "-"}</span>
        <span>size {d.size}</span>
        <span>OI {d.openInterest}</span>
        <span>prem ${num(d.premium, 0)}</span>
        <span>Δ {num(d.greeks?.delta ?? 0, 3)}</span>
        <span>UL ${num(d.underlyingPrice)}</span>
        <span>OPT ${num(d.optionPrice)}</span>
        <span>vol/OI {num(d.volOiRatio ?? 0, 2)}</span>
        <span className="text-slate-400">{d.assetClass}</span>
      </div>
      {d.historicalComparison && (
        <div className="mt-1 text-xs text-slate-400">
          hist avgOI {d.historicalComparison.avgOI} | avgVol {d.historicalComparison.avgVolume} | OIΔ {d.historicalComparison.oiChange} | Vol× {d.historicalComparison.volumeMultiple}
        </div>
      )}
    </div>
  );
}

function RowPrint({ p }: { p: any }) {
  return (
    <div className="p-3 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="sky">PRINT</Badge>
        <span className="text-slate-400 text-xs">{ts(p.timestamp)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-200">
        <span className="font-semibold">{p.symbol} {p.right} ${p.strike}</span>
        <span>exp {p.expiry || "-"}</span>
        <span>size {p.tradeSize}</span>
        <span>@ ${num(p.tradePrice)}</span>
        <span>prem ${num(p.premium, 0)}</span>
        <span>vol/OI {num(p.volOiRatio ?? 0, 2)}</span>
        <span>{p.aggressor ? "BUY-agg" : "SELL-agg"}</span>
      </div>
    </div>
  );
}

function RowQuote({ q, resolve }: { q: any; resolve: (id?: string | number) => Mapping | undefined }) {
  const isUL = q.type === "UL_LIVE_QUOTE";
  const m = resolve(q.conid);
  const label = labelFromMapping(m);

  return (
    <div className="p-3 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={isUL ? "cyan" : "slate"}>{isUL ? "UL" : "OPT"}</Badge>
        <span className="text-slate-400 text-xs">{ts(q.timestamp)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-200">
        <span className="font-semibold">{label ? label : `conid ${q.conid}`}</span>
        <span>last ${num(q.last)}</span>
        <span>bid ${num(q.bid)}</span>
        <span>ask ${num(q.ask)}</span>
        {!isUL && <span>Δ {num(q.delta ?? 0, 3)}</span>}
        {q.volume != null && <span>vol {q.volume}</span>}
      </div>
    </div>
  );
}

/* ======================= Filters ======================= */
function Filters({ filter, setFilter }: any) {
  const upd = (k: string, v: any) => setFilter((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="flex flex-wrap items-center gap-3 p-2 border-b border-slate-800/50 bg-slate-900/40">
      <input
        placeholder="Symbol filter (e.g., NVDA, /ES)"
        className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100"
        value={filter.symbol}
        onChange={(e) => upd("symbol", e.target.value.toUpperCase())}
      />
      <select value={filter.assetClass} onChange={(e) => upd("assetClass", e.target.value)} className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100">
        <option value="">All assets</option>
        <option value="EQUITY_OPTION">Equity options</option>
        <option value="FUTURES_OPTION">Futures options</option>
      </select>
      <select value={filter.direction} onChange={(e) => upd("direction", e.target.value)} className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100">
        <option value="">Any direction</option>
        <option value="BTO">BTO</option>
        <option value="STO">STO</option>
        <option value="BTC">BTC</option>
        <option value="STC">STC</option>
      </select>
      <div className="flex items-center gap-2 text-slate-300">
        <span className="text-xs">Premium ≥</span>
        <input type="number" className="w-28 bg-slate-800/60 border border-slate-700 rounded px-2 py-1" value={filter.minPremium} onChange={(e) => upd("minPremium", Number(e.target.value || 0))} />
      </div>
    </div>
  );
}

/* ======================= Main ======================= */
export default function TradeFlashUI() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const { status, lastMsg, connect, disconnect, send } = useWebSocket(wsUrl);

  // Auto-connect on mount
  useEffect(() => { connect(wsUrl); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const { trades, prints, quotes, welcome, avail } = useStreamBuckets(lastMsg, paused);
  const { resolve } = useConidMapping(lastMsg); // <-- mapping hook wired here

  const [tab, setTab] = useState("stream");
  const [filter, setFilter] = useState({ symbol: "", assetClass: "", direction: "", minPremium: 0 });

  // Mixed stream (Trades + Prints)
  const stream = useMemo(() => {
    const merged = [
      ...trades.map((x) => ({ _k: `${x.timestamp}-T-${x.conid ?? Math.random()}`, t: "TRADE", d: x })),
      ...prints.map((x) => ({ _k: `${x.timestamp}-P-${x.conid ?? Math.random()}`, t: "PRINT", d: x })),
    ].sort((a, b) => (b.d.timestamp || 0) - (a.d.timestamp || 0));
    return merged.slice(0, MAX_ROWS);
  }, [trades, prints]);

  const filteredTrades = useMemo(
    () =>
      trades.filter((d) => {
        if (filter.symbol && !(String(d.symbol || "").toUpperCase().includes(filter.symbol))) return false;
        if (filter.assetClass && d.assetClass !== filter.assetClass) return false;
        if (filter.direction && d.direction !== filter.direction) return false;
        if ((filter.minPremium || 0) > 0 && (d.premium || 0) < filter.minPremium) return false;
        return true;
      }),
    [trades, filter]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0; // newest at top
  }, [stream, filteredTrades, prints, quotes, autoScroll]);

  const tabs = [
    { key: "stream", label: "Stream", count: stream.length },
    { key: "trades", label: "Trades", count: filteredTrades.length },
    { key: "prints", label: "Prints", count: prints.length },
    { key: "quotes", label: "Quotes", count: quotes.length },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="px-4 pt-5 pb-2">
          <h1 className="text-xl font-semibold">TradeFlash – IBKR Flow Client</h1>
          <p className="text-slate-400 text-sm">Now resolving conId → real symbol from broadcasted CONID_MAPPING.</p>
        </div>

        <Toolbar wsUrl={wsUrl} setWsUrl={setWsUrl} status={status} onConnect={connect} onDisconnect={disconnect} />
        <Subs send={send} avail={avail} />

        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-slate-300 text-sm">
              <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
              Pause
            </label>
            <label className="flex items-center gap-2 text-slate-300 text-sm">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
          </div>
          <div className="text-xs text-slate-400">{welcome?.message}</div>
        </div>

        <Tabs tabs={tabs} active={tab} onTab={setTab} />
        {tab === "trades" && <Filters filter={filter} setFilter={setFilter} />}

        <div ref={containerRef} className="h-[70vh] overflow-auto border-x border-b border-slate-800/60 bg-slate-900/20">
          {tab === "stream" && (
            <div>
              {stream.map((row) => (row.t === "TRADE" ? <RowTrade key={row._k} d={row.d} /> : <RowPrint key={row._k} p={row.d} />))}
            </div>
          )}

          {tab === "trades" && (
            <div>
              {filteredTrades.map((d, i) => (
                <RowTrade key={(d.timestamp || i) + "-t"} d={d} />
              ))}
              {filteredTrades.length === 0 && <div className="p-6 text-slate-400 text-sm">No trades yet. Try widening filters or wait for data.</div>}
            </div>
          )}

          {tab === "prints" && (
            <div>
              {prints.map((p, i) => (
                <RowPrint key={(p.timestamp || i) + "-p"} p={p} />
              ))}
              {prints.length === 0 && <div className="p-6 text-slate-400 text-sm">No prints yet.</div>}
            </div>
          )}

          {tab === "quotes" && (
            <div>
              {quotes.map((q, i) => (
                <RowQuote key={(q.timestamp || i) + "-q"} q={q} resolve={resolve} />
              ))}
              {quotes.length === 0 && <div className="p-6 text-slate-400 text-sm">No quotes yet.</div>}
            </div>
          )}

          {tab === "settings" && (
            <div className="p-4 text-slate-300 space-y-3">
              <div>
                <div className="text-sm text-slate-400">WebSocket</div>
                <div className="text-xs">{wsUrl}</div>
              </div>
              <div className="text-sm text-slate-400">Tips</div>
              <ul className="list-disc ml-5 text-sm text-slate-300 space-y-1">
                <li>Quotes now show resolved labels when a CONID_MAPPING has been seen for that conId.</li>
                <li>For options, the label is: <code>SYMBOL YYYYMMDD RIGHT STRIKE</code>. For underlyings: just <code>SYMBOL</code>.</li>
                <li>If a label is missing, the raw <code>conid</code> will be displayed until a mapping message arrives.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
