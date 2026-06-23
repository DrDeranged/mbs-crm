export function DirectionC() {
  const navItems = [
    { label: "Dashboard", active: true, glyph: "⬡" },
    { label: "Leads", active: false, glyph: "◈" },
    { label: "Pipeline", active: false, glyph: "◎" },
    { label: "Comms", active: false, glyph: "⬢" },
    { label: "Marketing", active: false, glyph: "◇" },
    { label: "Lenders", active: false, glyph: "⊕" },
    { label: "Reports", active: false, glyph: "◉" },
  ];

  const kpis = [
    { label: "Active Leads", value: "2,847", delta: "+12.4%", up: true, from: "#7C3AED", to: "#4F46E5" },
    { label: "Pipeline Value", value: "$4.2M", delta: "+8.1%", up: true, from: "#0891B2", to: "#06B6D4" },
    { label: "Conversion", value: "23.6%", delta: "+2.3%", up: true, from: "#059669", to: "#10B981" },
    { label: "Avg Deal", value: "$186K", delta: "-1.2%", up: false, from: "#EA580C", to: "#F97316" },
  ];

  const leads = [
    { name: "Marcus Holt", co: "Apex Logistics", val: "$320K", status: "Qualified", score: 87 },
    { name: "Sarah Chen", co: "NovaBuild Co", val: "$185K", status: "Proposal", score: 72 },
    { name: "James Rivera", co: "Delta Corp", val: "$540K", status: "Negotiation", score: 94 },
    { name: "Emily Zhao", co: "Starfield LLC", val: "$97K", status: "New", score: 41 },
    { name: "Carlos Mendes", co: "Titan Group", val: "$230K", status: "Qualified", score: 78 },
  ];

  const scoreColor = (s: number) => s >= 85 ? "#10B981" : s >= 65 ? "#06B6D4" : s >= 45 ? "#F59E0B" : "#F87171";

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#0A0A0F", fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <div className="flex flex-col w-14 h-full flex-shrink-0 items-center py-4 gap-1" style={{
        background: "#0F0F16",
        borderRight: "1px solid rgba(124,58,237,0.2)"
      }}>
        {/* Logo */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black mb-4" style={{
          background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
          boxShadow: "0 0 20px rgba(124,58,237,0.5)",
          color: "#fff"
        }}>M</div>

        {navItems.map((item) => (
          <div key={item.label} className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer relative" style={{
            background: item.active ? "rgba(124,58,237,0.2)" : "transparent",
            border: item.active ? "1px solid rgba(124,58,237,0.4)" : "1px solid transparent",
          }} title={item.label}>
            <span style={{ color: item.active ? "#A78BFA" : "rgba(148,163,184,0.4)", fontSize: "13px" }}>{item.glyph}</span>
            {item.active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-l-full" style={{ background: "#7C3AED", boxShadow: "0 0 8px #7C3AED" }} />}
          </div>
        ))}

        <div className="flex-1" />

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{
          background: "linear-gradient(135deg, #7C3AED, #06B6D4)",
          color: "#fff",
          boxShadow: "0 0 12px rgba(124,58,237,0.3)"
        }}>A</div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{
          borderBottom: "1px solid rgba(124,58,237,0.1)",
          background: "rgba(15,15,22,0.95)",
          backdropFilter: "blur(8px)"
        }}>
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-bold tracking-tight" style={{ color: "#F1F5F9" }}>Dashboard</div>
              <div className="text-xs" style={{ color: "rgba(124,58,237,0.7)" }}>Jun 22, 2026</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs" style={{
              background: "rgba(124,58,237,0.1)",
              border: "1px solid rgba(124,58,237,0.25)",
              color: "#A78BFA"
            }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#A78BFA", boxShadow: "0 0 5px #A78BFA" }} />
              Live Feed
            </div>
            <div className="px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer" style={{
              background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
              color: "#fff",
              boxShadow: "0 0 12px rgba(124,58,237,0.4)"
            }}>+ New Lead</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* KPI Row */}
          <div className="grid grid-cols-4 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl p-4 relative overflow-hidden" style={{
                background: "#0F0F16",
                border: "1px solid rgba(255,255,255,0.06)"
              }}>
                {/* Gradient blob */}
                <div className="absolute inset-0 opacity-20" style={{
                  background: `radial-gradient(circle at 80% 20%, ${k.from}44, transparent 60%)`
                }} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs" style={{ color: "rgba(148,163,184,0.6)" }}>{k.label}</span>
                    <div className="w-5 h-5 rounded-lg" style={{ background: `linear-gradient(135deg, ${k.from}33, ${k.to}33)`, border: `1px solid ${k.from}44` }} />
                  </div>
                  <div className="text-xl font-bold mb-1" style={{
                    color: "#F1F5F9",
                    textShadow: `0 0 20px ${k.from}44`
                  }}>{k.value}</div>
                  <div className="text-xs font-medium flex items-center gap-1" style={{ color: k.up ? "#10B981" : "#F87171" }}>
                    <span>{k.up ? "↑" : "↓"}</span>
                    <span>{k.delta}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-3">
            {/* Area chart */}
            <div className="col-span-2 rounded-2xl p-4" style={{ background: "#0F0F16", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold" style={{ color: "#F1F5F9" }}>Pipeline Velocity</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.4)" }}>Last 7 days</div>
                </div>
                <div className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ color: "#A78BFA", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}>$4.2M total</div>
              </div>
              {/* SVG mini chart */}
              <div className="relative h-28">
                <svg className="w-full h-full" viewBox="0 0 300 80" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0,60 C30,55 50,40 75,35 C100,30 110,50 140,25 C170,5 185,35 210,20 C235,8 260,30 300,15 L300,80 L0,80 Z" fill="url(#chartGrad)" />
                  <path d="M0,60 C30,55 50,40 75,35 C100,30 110,50 140,25 C170,5 185,35 210,20 C235,8 260,30 300,15" fill="none" stroke="url(#lineGrad)" strokeWidth="2" />
                  <defs>
                    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#4F46E5" />
                      <stop offset="100%" stopColor="#06B6D4" />
                    </linearGradient>
                  </defs>
                  {/* Glow dot at peak */}
                  <circle cx="210" cy="20" r="3" fill="#7C3AED" />
                  <circle cx="210" cy="20" r="6" fill="none" stroke="#7C3AED" strokeWidth="1" opacity="0.4" />
                </svg>
                {/* X labels */}
                <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                    <span key={i} className="text-xs" style={{ color: "rgba(148,163,184,0.3)" }}>{d}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Activity */}
            <div className="rounded-2xl p-4" style={{ background: "#0F0F16", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-sm font-bold mb-3" style={{ color: "#F1F5F9" }}>Activity</div>
              <div className="space-y-2.5">
                {[
                  { msg: "New lead — web form", time: "2m", color: "#A78BFA" },
                  { msg: "Call logged — Holt", time: "5m", color: "#06B6D4" },
                  { msg: "Proposal sent", time: "12m", color: "#10B981" },
                  { msg: "Credit pull done", time: "18m", color: "#F59E0B" },
                  { msg: "Task overdue", time: "1h", color: "#F87171" },
                ].map((a, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-1 rounded-lg px-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.color, boxShadow: `0 0 5px ${a.color}` }} />
                    <span className="text-xs flex-1 truncate" style={{ color: "rgba(226,232,240,0.75)" }}>{a.msg}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: "rgba(148,163,184,0.35)" }}>{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "#0F0F16", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="text-sm font-bold" style={{ color: "#F1F5F9" }}>Lead Intelligence</div>
              <div className="flex gap-2">
                {["All", "Hot", "Warm", "Cold"].map((f, i) => (
                  <div key={f} className="px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer" style={{
                    background: i === 0 ? "rgba(124,58,237,0.2)" : "transparent",
                    color: i === 0 ? "#A78BFA" : "rgba(148,163,184,0.4)",
                    border: `1px solid ${i === 0 ? "rgba(124,58,237,0.3)" : "transparent"}`
                  }}>{f}</div>
                ))}
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  {["Lead", "Company", "Value", "Status", "Score"].map((h) => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => (
                  <tr key={i} className="cursor-pointer" style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold text-white" style={{
                          background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                          boxShadow: "0 0 8px rgba(124,58,237,0.3)"
                        }}>{l.name[0]}</div>
                        <span className="text-xs font-medium" style={{ color: "#F1F5F9" }}>{l.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>{l.co}</td>
                    <td className="px-5 py-2.5 text-xs font-bold" style={{ color: "#06B6D4" }}>{l.val}</td>
                    <td className="px-5 py-2.5">
                      <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{
                        background: "rgba(124,58,237,0.12)",
                        color: "#A78BFA",
                        border: "1px solid rgba(124,58,237,0.2)"
                      }}>{l.status}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full" style={{ width: `${l.score}%`, background: `linear-gradient(90deg, ${scoreColor(l.score)}, ${scoreColor(l.score)}88)`, boxShadow: `0 0 5px ${scoreColor(l.score)}` }} />
                        </div>
                        <span className="text-xs font-bold" style={{ color: scoreColor(l.score) }}>{l.score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
