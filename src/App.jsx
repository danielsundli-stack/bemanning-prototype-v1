import React, { useMemo, useState } from "react";

const initialTasks = [
  { id: "t_kunde", name: "Kundehenvendelser", min: 3, buffer: false },
  { id: "t_saker", name: "Saksbehandling", min: 4, buffer: false },
  { id: "t_kontroll", name: "Kvalitetskontroll", min: 1, buffer: false },
  { id: "t_forbedring", name: "Forbedring/utvikling", min: 0, buffer: true },
  { id: "t_backlog", name: "Backlog/ryddearbeid", min: 0, buffer: true },
];

const initialEmployees = [
  { id: "e_1", name: "Eksempel: Solveig", role: "Teamleder", taskId: "t_kunde", absent: false },
  { id: "e_2", name: "Eksempel: Kristoffer", role: "Senior depotrådgiver", taskId: "t_saker", absent: false },
  { id: "e_3", name: "Eksempel: Sondre", role: "Fagleder", taskId: "t_kontroll", absent: false },
];

function pill(bg, fg) {
  return {
    background: bg,
    color: fg,
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid rgba(0,0,0,0.06)",
  };
}

export default function App() {
  const [tasks, setTasks] = useState(initialTasks);
  const [employees, setEmployees] = useState(initialEmployees);
  const [tab, setTab] = useState("oppgaver");
  const [showAbsent, setShowAbsent] = useState(false);

  const byTask = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      const available = employees.filter((e) => !e.absent && e.taskId === t.id);
      const absent = employees.filter((e) => e.absent && e.taskId === t.id);
      const deficit = Math.max(0, (t.min || 0) - available.length);
      map.set(t.id, { available, absent, deficit });
    }
    return map;
  }, [tasks, employees]);

  const totals = useMemo(() => {
    const available = employees.filter((e) => !e.absent).length;
    const absent = employees.filter((e) => e.absent).length;
    const totalDeficit = tasks.reduce((sum, t) => sum + (byTask.get(t.id)?.deficit || 0), 0);
    return { available, absent, totalDeficit };
  }, [employees, tasks, byTask]);

  const setAbsent = (id, val) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, absent: val } : e)));
  };

  const setEmployeeTask = (id, taskId) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, taskId } : e)));
  };

  const autoBalance = () => {
    // Enkel og robust: Flytt ansatte fra buffer-oppgaver (min=0) til oppgaver med mangel.
    setEmployees((prev) => {
      const next = prev.map((e) => ({ ...e }));
      const taskById = new Map(tasks.map((t) => [t.id, t]));

      const countAvail = (taskId) => next.filter((e) => !e.absent && e.taskId === taskId).length;

      const deficits = tasks
        .map((t) => ({ id: t.id, need: Math.max(0, (t.min || 0) - countAvail(t.id)) }))
        .filter((d) => d.need > 0)
        .sort((a, b) => b.need - a.need);

      for (const d of deficits) {
        let remaining = d.need;
        while (remaining > 0) {
          const donor = next.find((e) => {
            if (e.absent) return false;
            const tt = taskById.get(e.taskId);
            return (tt?.min || 0) === 0 || tt?.buffer;
          });
          if (!donor) break;
          donor.taskId = d.id;
          remaining -= 1;
        }
      }

      return next;
    });
  };

  const card = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  const btn = (active) => ({
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: active ? "#e2e8f0" : "white",
    cursor: "pointer",
    fontWeight: active ? 700 : 600,
  });

  const page = {
    minHeight: "100vh",
    background: "linear-gradient(#f8fafc, #ffffff)",
    padding: 18,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    color: "#0f172a",
  };

  return (
    <div style={page}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Bemanning – Prototype v1</h1>
          <div style={{ color: "#475569", fontSize: 13 }}>
            Demo for oppgaver, ansatte, fravær, auto-balansering og oppgave→ansatt-visning.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div style={card}><div style={{fontWeight:700}}>Tilgjengelige</div><div style={{fontSize:22, fontWeight:800}}>{totals.available}</div><div style={{fontSize:12, color:'#64748b'}}>Ansatte uten fravær</div></div>
            <div style={card}><div style={{fontWeight:700}}>Fravær</div><div style={{fontSize:22, fontWeight:800}}>{totals.absent}</div><div style={{fontSize:12, color:'#64748b'}}>Tas ut av bemanning</div></div>
            <div style={card}><div style={{fontWeight:700}}>Underbemanning</div><div style={{fontSize:22, fontWeight:800}}>{totals.totalDeficit}</div><div style={{fontSize:12, color:'#64748b'}}>Sum mangler ift. min</div></div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button style={btn(tab === "oppgaver")} onClick={() => setTab("oppgaver")}>Oppgaver</button>
            <button style={btn(tab === "oppgavevisning")} onClick={() => setTab("oppgavevisning")}>Oppgaver → Ansatte</button>
            <button style={btn(tab === "ansatte")} onClick={() => setTab("ansatte")}>Ansatte</button>
            <div style={{ flex: 1 }} />
            <button style={{ ...btn(false), background: "#16a34a", color: "white", borderColor: "#16a34a" }} onClick={autoBalance}>
              Auto-balanser
            </button>
          </div>
        </header>

        {tab === "oppgaver" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {tasks
              .slice()
              .sort((a, b) => (byTask.get(b.id)?.deficit || 0) - (byTask.get(a.id)?.deficit || 0) || (b.min - a.min))
              .map((t) => {
                const info = byTask.get(t.id);
                const deficit = info?.deficit || 0;
                return (
                  <div key={t.id} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          {info?.available.length || 0} / {t.min} (tilgjengelige / min)
                          {t.min === 0 ? " • buffer" : ""}
                        </div>
                      </div>
                      {deficit > 0 ? (
                        <span style={pill("#fee2e2", "#991b1b")}>Mangler {deficit}</span>
                      ) : (
                        <span style={pill("#dcfce7", "#166534")}>OK</span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {tab === "oppgavevisning" && (
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Oppgaver → Hvem sitter hvor</div>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#334155" }}>
                <span>Vis fravær</span>
                <input type="checkbox" checked={showAbsent} onChange={() => setShowAbsent((v) => !v)} />
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {tasks.map((t) => {
                const info = byTask.get(t.id);
                const list = showAbsent ? [...(info?.available || []), ...(info?.absent || [])] : (info?.available || []);
                const deficit = info?.deficit || 0;

                return (
                  <div key={t.id} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          {info?.available.length || 0} / {t.min} (tilgjengelige / min)
                          {showAbsent && (info?.absent.length || 0) > 0 ? ` • +${info.absent.length} fravær` : ""}
                        </div>
                      </div>
                      {deficit > 0 ? (
                        <span style={pill("#fee2e2", "#991b1b")}>Mangler {deficit}</span>
                      ) : (
                        <span style={pill("#dcfce7", "#166534")}>OK</span>
                      )}
                    </div>

                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {list.length === 0 ? (
                        <span style={{ color: "#64748b", fontSize: 13 }}>Ingen ansatte</span>
                      ) : (
                        list.map((e) => (
                          <span
                            key={e.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: "1px solid #cbd5e1",
                              background: e.absent ? "#f1f5f9" : "#fff",
                              color: e.absent ? "#64748b" : "#0f172a",
                              fontSize: 13,
                            }}
                          >
                            <span style={{ fontWeight: 800 }}>{e.name}</span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>({e.role})</span>
                            {e.absent ? <span style={pill("#64748b", "#fff")}>Fravær</span> : null}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: "#64748b" }}>
              Bemanningskrav og «mangler» beregnes på tilgjengelige ansatte.
            </div>
          </div>
        )}

        {tab === "ansatte" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {employees
              .slice()
              .sort((a, b) => (a.absent === b.absent ? a.name.localeCompare(b.name) : a.absent ? 1 : -1))
              .map((e) => (
                <div key={e.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{e.name}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{e.role}</div>
                    </div>
                    {e.absent ? <span style={pill("#64748b", "#fff")}>Fravær</span> : <span style={pill("#dcfce7", "#166534")}>Tilgjengelig</span>}
                  </div>

                  <div style={{ height: 1, background: "#e5e7eb", margin: "12px 0" }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#334155" }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>Oppgave</span>
                      <select
                        value={e.taskId}
                        onChange={(ev) => setEmployeeTask(e.id, ev.target.value)}
                        style={{ padding: 8, borderRadius: 12, border: "1px solid #cbd5e1" }}
                      >
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#334155" }}>
                      <input type="checkbox" checked={e.absent} onChange={(ev) => setAbsent(e.id, ev.target.checked)} />
                      <span>Fravær</span>
                    </label>
                  </div>
                </div>
              ))}
          </div>
        )}

        <footer style={{ fontSize: 12, color: "#94a3b8", paddingBottom: 16 }}>
          GitHub Pages-ready Vite + React. Tips: Endre repo-navn? Oppdater <code>base</code> i <code>vite.config.js</code>.
        </footer>
      </div>
    </div>
  );
}
