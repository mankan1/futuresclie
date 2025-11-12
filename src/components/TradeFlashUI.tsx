import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TradeFlash UI – React Tabbed Client
 * -------------------------------------------------------------
 * A single-file React UI that connects to your IBKR Flow WS server
 * (ws://localhost:3000/ws by default). It shows tabs for Stream,
 * Trades, Prints, Quotes, and Settings. Includes subscribe controls
 * for futures/equities, filtering, pause, and auto-scroll.
 *
 * Drop this into a React app and render <TradeFlashUI />.
 * Tailwind recommended, but the layout works with plain CSS too.
 */

const DEFAULT_WS = "ws://localhost:3000/ws";
const MAX_ROWS = 500; // cap arrays to avoid memory bloat

// Basic badge styles
const Badge = ({ children, color = "slate" }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-${color}-800/20 text-${color}-300 border border-${color}-700/30`}>{children}</span>
);

const Tag = ({ t }) => {
  const map = {
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

const DirPill = ({ dir }) => {
  const color = dir === "BTO" || dir === "BTC" ? "emerald" : "amber";
  return <Badge color={color}>{dir}</Badge>;
};

function ts(t) {
  if (!t) return "";
  try { return new Date(t).toLocaleTimeString(); } catch { return ""; }
}

function num(x, d = 2) {
  const n = Number(x);
  if (!isFinite(n)) return "-";
  return n.toFixed(d);
}

function useWebSocket(url) {
  const [status, setStatus] = useState("disconnected");
  const [lastMsg, setLastMsg] = useState(null);
  const wsRef = useRef(null);
  const backoffRef = useRef(500);

  const connect = React.useCallback((customUrl) => {
    const u = customUrl || url;
    try {
      if (wsRef.current) wsRef.current.close();
    } catch {}

    setStatus("connecting");
    const ws = new WebSocket(u);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      backoffRef.current = 500;
    };

    ws.onclose = () => {
      setStatus("disconnected");
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        setLastMsg(data);
      } catch (e) {}
    };
  }, [url]);

  const disconnect = React.useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    setStatus("disconnected");
  }, []);

  const send = React.useCallback((obj) => {
    const s = JSON.stringify(obj);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(s);
      return true;
    }
    return false;
  }, []);

  return { status, lastMsg, connect, disconnect, send };
}

function Toolbar({ wsUrl, setWsUrl, status, onConnect, onDisconnect }) {
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
      <button
        className="px-3 py-2 rounded bg-emerald-700 text-emerald-50 hover:bg-emerald-600"
        onClick={() => onConnect(wsUrl)}
      >Connect</button>
      <button
        className="px-3 py-2 rounded bg-slate-700 text-slate-50 hover:bg-slate-600"
        onClick={onDisconnect}
      >Disconnect</button>
    </div>
  );
}

function Subs({ send, avail }) {
  const [futs, setFuts] = useState(["/ES", "/NQ"]);
  const [eqs, setEqs] = useState(["SPY", "QQQ"]);

  const toggle = (list, setList, v) => {
    setList((cur) => cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v));
  };

  const doSend = () => {
    send({ action: "subscribe", futuresSymbols: futs, equitySymbols: eqs });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border-b border-slate-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Futures:</span>
        <div className="flex gap-2 flex-wrap">
          {(avail?.futures || ["/ES","/NQ","/YM","/RTY","/CL","/GC"]).map(f => (
            <button key={f}
              onClick={() => toggle(futs, setFuts, f)}
              className={`px-2 py-1 rounded border text-sm ${futs.includes(f) ? "bg-cyan-800/30 border-cyan-600 text-cyan-200" : "bg-slate-800/40 border-slate-700 text-slate-300"}`}
            >{f}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Equities:</span>
        <div className="flex gap-2 flex-wrap">
          {(avail?.equities || ["SPY","QQQ","AAPL","TSLA","NVDA","AMZN","MSFT","META","GOOGL"]).map(s => (
            <button key={s}
              onClick={() => toggle(eqs, setEqs, s)}
              className={`px-2 py-1 rounded border text-sm ${eqs.includes(s) ? "bg-fuchsia-800/30 border-fuchsia-600 text-fuchsia-200" : "bg-slate-800/40 border-slate-700 text-slate-300"}`}
            >{s}</button>
          ))}
        </div>
      </div>
      <button onClick={doSend} className="ml-auto px-3 py-2 rounded bg-indigo-700 text-indigo-50 hover:bg-indigo-600">Subscribe</button>
    </div>
  );
}

function Tabs({ tabs, active, onTab }) {
  return (
    <div className="border-b border-slate-800/60 bg-slate-900/40">
      <div className="flex gap-1 p-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key}
            onClick={() => onTab(t.key)}
            className={`px-3 py-2 rounded-t ${active===t.key ? "bg-slate-800 text-white" : "text-slate-300 hover:text-white"}`}
          >{t.label}{t.count != null && <span className="ml-2 text-xs text-slate-400">{t.count}</span>}</button>
        ))}
      </div>
    </div>
  );
}

function RowTrade({ d }) {
  const klass = (d.classifications||[]).join(" ");
  return (
    <div className="p-3 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <DirPill dir={d.direction} />
        {(d.classifications||[]).map(t => <Tag key={t} t={t} />)}
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

function RowPrint({ p }) {
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

function RowQuote({ q }) {
  const isUL = q.type === "UL_LIVE_QUOTE";
  return (
    <div className="p-3 border-b border-slate-800/50 hover:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={isUL ? "cyan" : "slate"}>{isUL ? "UL" : "OPT"}</Badge>
        <span className="text-slate-400 text-xs">{ts(q.timestamp)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-200">
        <span>conid {q.conid}</span>
        <span>last ${num(q.last)}</span>
        <span>bid ${num(q.bid)}</span>
        <span>ask ${num(q.ask)}</span>
        {isUL ? null : <span>Δ {num(q.delta ?? 0, 3)}</span>}
        {q.volume != null && <span>vol {q.volume}</span>}
      </div>
    </div>
  );
}

function useStreamBuckets(lastMsg, paused) {
  const [trades, setTrades] = useState([]);
  const [prints, setPrints] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [welcome, setWelcome] = useState(null);
  const [avail, setAvail] = useState({ futures: [], equities: [] });

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

function Filters({ filter, setFilter }) {
  const upd = (k, v) => setFilter((f) => ({ ...f, [k]: v }));
  return (
    <div className="flex flex-wrap items-center gap-3 p-2 border-b border-slate-800/50 bg-slate-900/40">
      <input
        placeholder="Symbol filter (e.g., NVDA, /ES)"
        className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100"
        value={filter.symbol}
        onChange={(e)=>upd('symbol', e.target.value.toUpperCase())}
      />
      <select
        value={filter.assetClass}
        onChange={(e)=>upd('assetClass', e.target.value)}
        className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100"
      >
        <option value="">All assets</option>
        <option value="EQUITY_OPTION">Equity options</option>
        <option value="FUTURES_OPTION">Futures options</option>
      </select>
      <select
        value={filter.direction}
        onChange={(e)=>upd('direction', e.target.value)}
        className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-100"
      >
        <option value="">Any direction</option>
        <option value="BTO">BTO</option>
        <option value="STO">STO</option>
        <option value="BTC">BTC</option>
        <option value="STC">STC</option>
      </select>
      <div className="flex items-center gap-2 text-slate-300">
        <span className="text-xs">Premium ≥</span>
        <input type="number" className="w-28 bg-slate-800/60 border border-slate-700 rounded px-2 py-1"
          value={filter.minPremium}
          onChange={(e)=>upd('minPremium', Number(e.target.value||0))}
        />
      </div>
    </div>
  );
}

export default function TradeFlashUI() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const { status, lastMsg, connect, disconnect, send } = useWebSocket(wsUrl);

  // Auto-connect once on mount
  useEffect(() => { connect(wsUrl); /* eslint-disable-next-line */ }, []);

  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const { trades, prints, quotes, welcome, avail } = useStreamBuckets(lastMsg, paused);

  const [tab, setTab] = useState("stream");
  const [filter, setFilter] = useState({ symbol: "", assetClass: "", direction: "", minPremium: 0 });

  const stream = useMemo(() => {
    const merged = [
      ...trades.map(x => ({ _k: x.timestamp+"-T-"+(x.conid||Math.random()), t: "TRADE", d: x })),
      ...prints.map(x => ({ _k: x.timestamp+"-P-"+(x.conid||Math.random()), t: "PRINT", d: x })),
    ].sort((a,b) => (b.d.timestamp||0) - (a.d.timestamp||0));
    return merged.slice(0, MAX_ROWS);
  }, [trades, prints]);

  const filteredTrades = useMemo(() => trades.filter(d => {
    if (filter.symbol && !(d.symbol||"").toUpperCase().includes(filter.symbol)) return false;
    if (filter.assetClass && d.assetClass !== filter.assetClass) return false;
    if (filter.direction && d.direction !== filter.direction) return false;
    if ((filter.minPremium||0) > 0 && (d.premium||0) < filter.minPremium) return false;
    return true;
  }), [trades, filter]);

  const containerRef = useRef(null);
  useEffect(() => {
    if (!autoScroll) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0; // newest at top; keep top in view
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
          <p className="text-slate-400 text-sm">Tabs for Stream / Trades / Prints / Quotes. Subscribe per-WS, live.</p>
        </div>

        <Toolbar wsUrl={wsUrl} setWsUrl={setWsUrl} status={status} onConnect={connect} onDisconnect={disconnect} />
        <Subs send={send} avail={avail} />

        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-slate-300 text-sm">
              <input type="checkbox" checked={paused} onChange={(e)=>setPaused(e.target.checked)} />
              Pause
            </label>
            <label className="flex items-center gap-2 text-slate-300 text-sm">
              <input type="checkbox" checked={autoScroll} onChange={(e)=>setAutoScroll(e.target.checked)} />
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
              {stream.map((row) => row.t === "TRADE" ? (
                <RowTrade key={row._k} d={row.d} />
              ) : (
                <RowPrint key={row._k} p={row.d} />
              ))}
            </div>
          )}

          {tab === "trades" && (
            <div>
              {filteredTrades.map((d, i) => <RowTrade key={(d.timestamp||i)+"-t"} d={d} />)}
              {filteredTrades.length === 0 && (
                <div className="p-6 text-slate-400 text-sm">No trades yet. Try widening filters or wait for data.</div>
              )}
            </div>
          )}

          {tab === "prints" && (
            <div>
              {prints.map((p, i) => <RowPrint key={(p.timestamp||i)+"-p"} p={p} />)}
              {prints.length === 0 && (
                <div className="p-6 text-slate-400 text-sm">No prints yet.</div>
              )}
            </div>
          )}

          {tab === "quotes" && (
            <div>
              {quotes.map((q, i) => <RowQuote key={(q.timestamp||i)+"-q"} q={q} />)}
              {quotes.length === 0 && (
                <div className="p-6 text-slate-400 text-sm">No quotes yet.</div>
              )}
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
                <li>Use the Subscribe bar to pick futures & equities, then click <b>Subscribe</b>.</li>
                <li>Stream tab mixes Trades & Prints (newest first). Toggle <b>Pause</b> to inspect items.</li>
                <li>Trades include vol/OI, greeks (Δ only if supplied), and confidence score.</li>
                <li>Quotes tab shows both UL and OPT snapshots as they stream in.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

