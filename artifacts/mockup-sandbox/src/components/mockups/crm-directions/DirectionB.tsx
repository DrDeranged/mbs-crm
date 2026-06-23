export function DirectionB() {
  const navItems = [
    { icon: "▣", label: "Dashboard", active: true },
    { icon: "◈", label: "Leads", active: false },
    { icon: "◎", label: "Pipeline", active: false },
    { icon: "⬢", label: "Communications", active: false },
    { icon: "◇", label: "Marketing", active: false },
    { icon: "⊕", label: "Lenders", active: false },
    { icon: "◉", label: "Reports", active: false },
  ];

  const kpis = [
    { label: "Active Leads", value: "2,847", change: "+12.4%", up: true, accent: "#1F4E79" },
    { label: "Pipeline Value", value: "$4.2M", change: "+8.1%", up: true, accent: "#0369A1" },
    { label: "Conversion Rate", value: "23.6%", change: "+2.3%", up: true, accent: "#0891B2" },
    { label: "Avg Deal Size", value: "$186K", change: "-1.2%", up: false, accent: "#0E7490" },
  ];

  const leads = [
    { name: "Marcus Holt", company: "Apex Logistics", value: "$320K", status: "Qualified", avatar: "MH" },
    { name: "Sarah Chen", company: "NovaBuild Co", value: "$185K", status: "Proposal", avatar: "SC" },
    { name: "James Rivera", company: "Delta Corp", value: "$540K", status: "Negotiation", avatar: "JR" },
    { name: "Emily Zhao", company: "Starfield LLC", value: "$97K", status: "New", avatar: "EZ" },
    { name: "Carlos Mendes", company: "Titan Group", value: "$230K", status: "Qualified", avatar: "CM" },
  ];

  const statusColor: Record<string, { bg: string; text: string }> = {
    Qualified: { bg: "#EFF6FF", text: "#1D4ED8" },
    Proposal: { bg: "#F0FDF4", text: "#15803D" },
    Negotiation: { bg: "#FAF5FF", text: "#7E22CE" },
    New: { bg: "#F8FAFC", text: "#475569" },
  };

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#F0F5FA", fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <div className="flex flex-col w-56 h-full flex-shrink-0" style={{
        background: "#FFFFFF",
        borderRight: "1px solid #E2EAF0"
      }}>
        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: "#1F4E79" }}>M</div>
          <div>
            <div className="text-sm font-bold tracking-tight" style={{ color: "#0F1C2E" }}>MBS CRM</div>
            <div className="text-xs" style={{ color: "#94A3B8" }}>Business Solutions</div>
          </div>
        </div>

        <div className="mx-5 mb-4" style={{ height: "1px", background: "#EEF2F7" }} />

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map((item) => (
            <div key={item.label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all" style={{
              background: item.active ? "#EEF6FF" : "transparent",
            }}>
              <span style={{ color: item.active ? "#1F4E79" : "#94A3B8", fontSize: "13px" }}>{item.icon}</span>
              <span className="text-xs font-medium" style={{ color: item.active ? "#1F4E79" : "#64748B" }}>{item.label}</span>
              {item.active && (
                <div className="ml-auto w-5 h-5 rounded-lg flex items-center justify-center text-xs" style={{ background: "#1F4E79", color: "#fff" }}>•</div>
              )}
            </div>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-5 my-3" style={{ height: "1px", background: "#EEF2F7" }} />

        {/* User */}
        <div className="p-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#F8FAFC" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#1F4E79" }}>A</div>
            <div>
              <div className="text-xs font-semibold" style={{ color: "#0F1C2E" }}>Admin User</div>
              <div className="text-xs" style={{ color: "#94A3B8" }}>Administrator</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #E2EAF0"
        }}>
          <div>
            <h1 className="text-base font-bold tracking-tight" style={{ color: "#0F1C2E" }}>Dashboard</h1>
            <p className="text-xs" style={{ color: "#94A3B8" }}>Monday, June 22, 2026</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs" style={{ background: "#F8FAFC", border: "1px solid #E2EAF0", color: "#94A3B8", width: 160 }}>
              <span>⌕</span> Search leads...
            </div>
            <div className="px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer text-white" style={{ background: "#1F4E79" }}>+ New Lead</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl p-4 bg-white" style={{ border: "1px solid #E2EAF0", boxShadow: "0 1px 3px rgba(30,64,120,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium" style={{ color: "#64748B" }}>{k.label}</div>
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: "#EEF6FF" }}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: k.accent }} />
                  </div>
                </div>
                <div className="text-xl font-bold mb-1" style={{ color: "#0F1C2E" }}>{k.value}</div>
                <div className="flex items-center gap-1 text-xs font-medium" style={{ color: k.up ? "#15803D" : "#DC2626" }}>
                  <span>{k.up ? "↑" : "↓"}</span>
                  <span>{k.change} vs last month</span>
                </div>
              </div>
            ))}
          </div>

          {/* Chart + Breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {/* Chart */}
            <div className="col-span-2 rounded-2xl bg-white p-4" style={{ border: "1px solid #E2EAF0", boxShadow: "0 1px 3px rgba(30,64,120,0.06)" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold" style={{ color: "#0F1C2E" }}>Revenue Pipeline</div>
                  <div className="text-xs" style={{ color: "#94A3B8" }}>Weekly progression</div>
                </div>
                <div className="flex gap-1.5">
                  {["Week", "Month", "Quarter"].map((t, i) => (
                    <div key={t} className="px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer" style={{
                      background: i === 0 ? "#1F4E79" : "#F8FAFC",
                      color: i === 0 ? "#fff" : "#64748B",
                      border: `1px solid ${i === 0 ? "#1F4E79" : "#E2EAF0"}`
                    }}>{t}</div>
                  ))}
                </div>
              </div>
              {/* Chart */}
              <div className="flex items-end gap-2 h-28 px-2">
                {[40, 65, 52, 80, 58, 92, 72].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-lg relative" style={{
                      height: `${h * 0.85}%`,
                      background: i === 5 ? "#1F4E79" : "#EEF6FF",
                      border: i === 5 ? "none" : "1px solid #DBEAFE"
                    }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between px-2 mt-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="flex-1 text-center text-xs" style={{ color: "#CBD5E1" }}>{d}</div>
                ))}
              </div>
            </div>

            {/* Stage Breakdown */}
            <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid #E2EAF0", boxShadow: "0 1px 3px rgba(30,64,120,0.06)" }}>
              <div className="text-sm font-bold mb-4" style={{ color: "#0F1C2E" }}>Stage Breakdown</div>
              <div className="space-y-3">
                {[
                  { label: "New Leads", count: 284, pct: 32, color: "#94A3B8" },
                  { label: "Qualified", count: 198, pct: 52, color: "#3B82F6" },
                  { label: "Proposal", count: 87, pct: 68, color: "#1F4E79" },
                  { label: "Negotiation", count: 43, pct: 84, color: "#6366F1" },
                  { label: "Closed Won", count: 31, pct: 95, color: "#10B981" },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: "#64748B" }}>{s.label}</span>
                      <span className="text-xs font-semibold" style={{ color: "#0F1C2E" }}>{s.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
                      <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-2xl bg-white overflow-hidden" style={{ border: "1px solid #E2EAF0", boxShadow: "0 1px 3px rgba(30,64,120,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #F1F5F9" }}>
              <div className="text-sm font-bold" style={{ color: "#0F1C2E" }}>Recent Leads</div>
              <div className="text-xs cursor-pointer" style={{ color: "#1F4E79", fontWeight: 600 }}>View all →</div>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ background: "#FAFBFD" }}>
                  {["Contact", "Company", "Deal Value", "Status"].map((h) => (
                    <th key={h} className="text-left px-5 py-2.5 text-xs font-semibold" style={{ color: "#94A3B8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "#F1F5F9" }}>
                {leads.map((l, i) => (
                  <tr key={i} className="cursor-pointer hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#1F4E79" }}>{l.avatar}</div>
                        <span className="text-xs font-medium" style={{ color: "#0F1C2E" }}>{l.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "#64748B" }}>{l.company}</td>
                    <td className="px-5 py-3 text-xs font-bold" style={{ color: "#0F1C2E" }}>{l.value}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{
                        background: statusColor[l.status]?.bg ?? "#F8FAFC",
                        color: statusColor[l.status]?.text ?? "#64748B"
                      }}>{l.status}</span>
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
