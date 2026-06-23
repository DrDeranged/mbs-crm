export function DirectionA() {
  const navItems = [
    { icon: "⬡", label: "Dashboard", active: true },
    { icon: "◈", label: "Leads", active: false },
    { icon: "◎", label: "Pipeline", active: false },
    { icon: "⬢", label: "Communications", active: false },
    { icon: "◇", label: "Marketing", active: false },
    { icon: "⊕", label: "Lenders", active: false },
    { icon: "◉", label: "Reports", active: false },
  ];

  const kpis = [
    { label: "Active Leads", value: "2,847", change: "+12.4%", up: true, color: "#38BDF8" },
    { label: "Pipeline Value", value: "$4.2M", change: "+8.1%", up: true, color: "#34D399" },
    { label: "Conversion Rate", value: "23.6%", change: "+2.3%", up: true, color: "#A78BFA" },
    { label: "Avg Deal Size", value: "$186K", change: "-1.2%", up: false, color: "#FB923C" },
  ];

  const leads = [
    { name: "Marcus Holt", company: "Apex Logistics", value: "$320K", status: "Qualified", stage: 75 },
    { name: "Sarah Chen", company: "NovaBuild Co", value: "$185K", status: "Proposal", stage: 55 },
    { name: "James Rivera", company: "Delta Corp", value: "$540K", status: "Negotiation", stage: 88 },
    { name: "Emily Zhao", company: "Starfield LLC", value: "$97K", status: "New", stage: 20 },
    { name: "Carlos Mendes", company: "Titan Group", value: "$230K", status: "Qualified", stage: 60 },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#03080F", fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <div className="flex flex-col w-56 h-full flex-shrink-0 relative" style={{
        background: "linear-gradient(180deg, #050D1A 0%, #071428 100%)",
        borderRight: "1px solid rgba(56, 189, 248, 0.12)"
      }}>
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: "linear-gradient(rgba(56,189,248,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.3) 1px, transparent 1px)",
          backgroundSize: "20px 20px"
        }} />

        {/* Logo */}
        <div className="relative px-4 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{
            background: "linear-gradient(135deg, #1F4E79, #38BDF8)",
            boxShadow: "0 0 16px rgba(56,189,248,0.4)"
          }}>M</div>
          <div>
            <div className="text-xs font-bold tracking-widest uppercase" style={{ color: "#E2F4FF" }}>MBS</div>
            <div className="text-xs tracking-wider" style={{ color: "rgba(56,189,248,0.6)" }}>CRM SYSTEM</div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 mb-4" style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(56,189,248,0.3), transparent)" }} />

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5 relative">
          {navItems.map((item) => (
            <div key={item.label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all" style={{
              background: item.active ? "linear-gradient(90deg, rgba(56,189,248,0.15), rgba(56,189,248,0.05))" : "transparent",
              borderLeft: item.active ? "2px solid #38BDF8" : "2px solid transparent",
            }}>
              <span style={{ color: item.active ? "#38BDF8" : "rgba(148,163,184,0.6)", fontSize: "14px" }}>{item.icon}</span>
              <span className="text-xs font-medium tracking-wide" style={{ color: item.active ? "#E2F4FF" : "rgba(148,163,184,0.6)" }}>{item.label}</span>
              {item.active && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#38BDF8", boxShadow: "0 0 6px #38BDF8" }} />}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="relative p-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.1)" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "linear-gradient(135deg, #1F4E79, #38BDF8)", color: "#fff" }}>A</div>
            <div>
              <div className="text-xs font-medium" style={{ color: "#E2F4FF" }}>Admin User</div>
              <div className="text-xs" style={{ color: "rgba(56,189,248,0.5)" }}>Online</div>
            </div>
            <div className="ml-auto w-2 h-2 rounded-full" style={{ background: "#34D399", boxShadow: "0 0 6px #34D399" }} />
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{
          borderBottom: "1px solid rgba(56,189,248,0.08)",
          background: "rgba(5,13,26,0.8)",
          backdropFilter: "blur(12px)"
        }}>
          <div>
            <h1 className="text-base font-semibold tracking-wide" style={{ color: "#E2F4FF" }}>Operations Dashboard</h1>
            <p className="text-xs" style={{ color: "rgba(56,189,248,0.5)" }}>Mon, Jun 22 2026 · Live data</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", color: "#38BDF8" }}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#38BDF8" }} />
              LIVE
            </div>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)", color: "#38BDF8", fontSize: "14px" }}>⊕</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* KPI Row */}
          <div className="grid grid-cols-4 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl p-4 relative overflow-hidden" style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                border: `1px solid ${k.color}22`,
                backdropFilter: "blur(8px)"
              }}>
                <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-10" style={{ background: k.color, filter: "blur(20px)", transform: "translate(30%, -30%)" }} />
                <div className="text-xs mb-2 tracking-wide" style={{ color: "rgba(148,163,184,0.7)" }}>{k.label}</div>
                <div className="text-xl font-bold mb-1" style={{ color: "#E2F4FF" }}>{k.value}</div>
                <div className="text-xs font-medium" style={{ color: k.up ? "#34D399" : "#F87171" }}>
                  {k.up ? "↑" : "↓"} {k.change}
                </div>
                <div className="absolute bottom-3 right-3 w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${k.color}22` }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: k.color }} />
                </div>
              </div>
            ))}
          </div>

          {/* Chart + Activity Row */}
          <div className="grid grid-cols-3 gap-3">
            {/* Mini chart area */}
            <div className="col-span-2 rounded-xl p-4" style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(56,189,248,0.1)"
            }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#E2F4FF" }}>Pipeline Velocity</div>
                  <div className="text-xs" style={{ color: "rgba(56,189,248,0.5)" }}>Last 7 days</div>
                </div>
                <div className="flex gap-2">
                  {["1W", "1M", "3M"].map((t) => (
                    <div key={t} className="px-2 py-0.5 rounded text-xs cursor-pointer" style={{ background: t === "1W" ? "rgba(56,189,248,0.15)" : "transparent", color: t === "1W" ? "#38BDF8" : "rgba(148,163,184,0.5)", border: `1px solid ${t === "1W" ? "rgba(56,189,248,0.3)" : "transparent"}` }}>{t}</div>
                  ))}
                </div>
              </div>
              {/* Fake chart bars */}
              <div className="flex items-end gap-2 h-24">
                {[45, 72, 58, 89, 63, 94, 78].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-sm relative" style={{
                    height: `${h}%`,
                    background: i === 5 ? "linear-gradient(180deg, #38BDF8, #1F4E79)" : "rgba(56,189,248,0.15)",
                    boxShadow: i === 5 ? "0 0 12px rgba(56,189,248,0.4)" : "none"
                  }}>
                    {i === 5 && <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{ background: "#38BDF8", boxShadow: "0 0 6px #38BDF8" }} />}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="flex-1 text-center text-xs" style={{ color: "rgba(148,163,184,0.4)" }}>{d}</div>
                ))}
              </div>
            </div>

            {/* Activity feed */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.1)" }}>
              <div className="text-sm font-semibold mb-3" style={{ color: "#E2F4FF" }}>Live Activity</div>
              <div className="space-y-2.5">
                {[
                  { msg: "New lead from web form", time: "2m", dot: "#38BDF8" },
                  { msg: "Marcus Holt — call logged", time: "5m", dot: "#34D399" },
                  { msg: "Proposal sent to NovaBuild", time: "12m", dot: "#A78BFA" },
                  { msg: "Credit pull completed", time: "18m", dot: "#FB923C" },
                  { msg: "Task overdue: Follow up", time: "1h", dot: "#F87171" },
                ].map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.dot, boxShadow: `0 0 4px ${a.dot}` }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate" style={{ color: "rgba(226,244,255,0.8)" }}>{a.msg}</div>
                      <div className="text-xs" style={{ color: "rgba(148,163,184,0.4)" }}>{a.time} ago</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Lead Table */}
          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(56,189,248,0.1)" }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.08)" }}>
              <div className="text-sm font-semibold" style={{ color: "#E2F4FF" }}>Active Leads</div>
              <div className="px-3 py-1 rounded-lg text-xs cursor-pointer" style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", color: "#38BDF8" }}>+ New Lead</div>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(56,189,248,0.06)" }}>
                  {["Name", "Company", "Value", "Status", "Stage"].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-medium tracking-widest uppercase" style={{ color: "rgba(56,189,248,0.4)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => (
                  <tr key={i} className="cursor-pointer transition-colors" style={{ borderBottom: "1px solid rgba(56,189,248,0.04)" }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: "linear-gradient(135deg, #1F4E79, #38BDF8)", color: "#fff" }}>{l.name[0]}</div>
                        <span className="text-xs font-medium" style={{ color: "#E2F4FF" }}>{l.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "rgba(148,163,184,0.7)" }}>{l.company}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ color: "#34D399" }}>{l.value}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{
                        background: l.status === "Negotiation" ? "rgba(167,139,250,0.15)" : l.status === "Qualified" ? "rgba(56,189,248,0.12)" : l.status === "Proposal" ? "rgba(52,211,153,0.12)" : "rgba(148,163,184,0.1)",
                        color: l.status === "Negotiation" ? "#A78BFA" : l.status === "Qualified" ? "#38BDF8" : l.status === "Proposal" ? "#34D399" : "rgba(148,163,184,0.7)",
                        border: `1px solid ${l.status === "Negotiation" ? "rgba(167,139,250,0.2)" : l.status === "Qualified" ? "rgba(56,189,248,0.2)" : l.status === "Proposal" ? "rgba(52,211,153,0.2)" : "rgba(148,163,184,0.1)"}`
                      }}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2.5 w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.1)" }}>
                          <div className="h-full rounded-full" style={{ width: `${l.stage}%`, background: "linear-gradient(90deg, #1F4E79, #38BDF8)", boxShadow: "0 0 6px rgba(56,189,248,0.4)" }} />
                        </div>
                        <span className="text-xs w-7 text-right" style={{ color: "rgba(56,189,248,0.6)" }}>{l.stage}%</span>
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
