import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, RefreshCcw, Users, ClipboardList, AlertTriangle, CheckCircle2, UserX, ArrowRight, Wand2, Trash2, Pencil } from "lucide-react";

// ============================
// Prototype: Bemanning & Oppgaver
// - In-memory + localStorage
// - Auto-balansering ved fravær og minimumsbemanning
// - Flere ansatte kan være på samme oppgave
// - Oppgaver kan ha min=0 ("buffer"/"venter")
// - Hver ansatt kan ha en prioriteringsliste for "neste oppgaver"
// ============================

const LS_KEY = "bemanning_oppgaver_v1";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeInt(v, fallback = 0) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.trunc(n);
  return fallback;
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// --- Types (informal)
// Employee: { id, name, role, absent, currentTaskId: string|null, nextTaskIds: string[], eligibleTaskIds: string[] }
// Task: { id, name, minStaff: number, description, isBuffer: boolean }

const seed = {
  tasks: [
    { id: "t_kunde", name: "Kundehenvendelser", minStaff: 3, description: "Telefon/Teams/henvendelser", isBuffer: false },
    { id: "t_saker", name: "Saksbehandling", minStaff: 4, description: "Behandle innkommende saker", isBuffer: false },
    { id: "t_kontroll", name: "Kvalitetskontroll", minStaff: 1, description: "Stikkprøver og kvalitet", isBuffer: false },
    { id: "t_forbedring", name: "Forbedring/utvikling", minStaff: 0, description: "Rutiner, automasjon, forbedringsarbeid", isBuffer: true },
    { id: "t_backlog", name: "Backlog/ryddearbeid", minStaff: 0, description: "Oppgaver man kan gå over på når annet er ferdig", isBuffer: true },
  ],
  employees: [
    {
      id: "e_1",
      name: "Eksempel: Solveig",
      role: "Teamleder",
      absent: false,
      currentTaskId: "t_kunde",
      nextTaskIds: ["t_saker", "t_kontroll", "t_forbedring"],
      eligibleTaskIds: ["t_kunde", "t_saker", "t_kontroll", "t_forbedring", "t_backlog"],
    },
    {
      id: "e_2",
      name: "Eksempel: Kristoffer",
      role: "Senior depotrådgiver",
      absent: false,
      currentTaskId: "t_saker",
      nextTaskIds: ["t_kontroll", "t_kunde", "t_forbedring"],
      eligibleTaskIds: ["t_kunde", "t_saker", "t_kontroll", "t_forbedring", "t_backlog"],
    },
    {
      id: "e_3",
      name: "Eksempel: Sondre",
      role: "Fagleder",
      absent: false,
      currentTaskId: "t_kontroll",
      nextTaskIds: ["t_saker", "t_kunde", "t_forbedring"],
      eligibleTaskIds: ["t_kunde", "t_saker", "t_kontroll", "t_forbedring", "t_backlog"],
    },
  ],
};

function loadState() {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
  if (!raw) return seed;
  const parsed = safeParse(raw, seed);
  // Light validation
  return {
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : seed.tasks,
    employees: Array.isArray(parsed.employees) ? parsed.employees : seed.employees,
  };
}

function saveState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function countAssigned(employees, taskId) {
  return employees.filter((e) => !e.absent && e.currentTaskId === taskId).length;
}

function getTask(tasks, taskId) {
  return tasks.find((t) => t.id === taskId) || null;
}

function isEligible(employee, taskId) {
  return (employee.eligibleTaskIds || []).includes(taskId);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

// --- Core balancing algorithm (simple + deterministic)
// Goal:
// 1) Ensure each task has >= minStaff (considering only available employees).
// 2) Reassign from surplus tasks (above min) first, then from buffer tasks (min=0), then from unassigned.
// 3) Respect eligibility; prefer employees whose nextTaskIds includes the deficit task.
function autoBalance({ tasks, employees }) {
  const nextEmployees = employees.map((e) => ({ ...e }));

  const available = nextEmployees.filter((e) => !e.absent);

  // Build current counts
  const counts = new Map(tasks.map((t) => [t.id, countAssigned(nextEmployees, t.id)]));

  const deficits = tasks
    .filter((t) => (t.minStaff || 0) > 0)
    .map((t) => ({
      taskId: t.id,
      need: Math.max(0, (t.minStaff || 0) - (counts.get(t.id) || 0)),
    }))
    .filter((d) => d.need > 0);

  if (deficits.length === 0) {
    return { tasks, employees: nextEmployees, changes: [] };
  }

  // Candidate donors: employees from tasks with surplus (count > min)
  // plus employees sitting on buffer tasks (min=0)
  function taskMin(taskId) {
    const t = getTask(tasks, taskId);
    return t ? normalizeInt(t.minStaff, 0) : 0;
  }

  const changes = [];

  const donorScore = (e, deficitTaskId) => {
    // Lower is better
    const nextIdx = (e.nextTaskIds || []).indexOf(deficitTaskId);
    const prefers = nextIdx === -1 ? 99 : nextIdx;
    const currentlyOnBuffer = (() => {
      const t = getTask(tasks, e.currentTaskId);
      return t?.isBuffer ? 0 : 1;
    })();
    // Prefer donors from buffer first, then those who already want to move.
    return prefers * 10 + currentlyOnBuffer;
  };

  function getDonorsFor(deficitTaskId) {
    const donors = available
      .filter((e) => {
        if (!e.currentTaskId) return true; // Unassigned
        const c = counts.get(e.currentTaskId) || 0;
        const min = taskMin(e.currentTaskId);
        const t = getTask(tasks, e.currentTaskId);
        const isBuffer = !!t?.isBuffer || min === 0;
        // donor if surplus or buffer or unassigned
        return isBuffer || c > min;
      })
      .filter((e) => isEligible(e, deficitTaskId));

    return donors.sort((a, b) => donorScore(a, deficitTaskId) - donorScore(b, deficitTaskId));
  }

  for (const d of deficits.sort((a, b) => b.need - a.need)) {
    let remaining = d.need;
    while (remaining > 0) {
      const donors = getDonorsFor(d.taskId);
      if (donors.length === 0) break;

      const chosen = donors[0];
      const prevTaskId = chosen.currentTaskId;

      // Update counts for previous task
      if (prevTaskId) {
        counts.set(prevTaskId, Math.max(0, (counts.get(prevTaskId) || 0) - 1));
      }
      // Assign to new task
      chosen.currentTaskId = d.taskId;
      counts.set(d.taskId, (counts.get(d.taskId) || 0) + 1);

      changes.push({ employeeId: chosen.id, from: prevTaskId, to: d.taskId, reason: "Auto-balansering" });
      remaining -= 1;

      // Remove from available list order to avoid re-picking same donor repeatedly in this round
      // (We keep them available, but their current task has changed, donor rules will shift.)
    }
  }

  return { tasks, employees: nextEmployees, changes };
}

function moveEmployeeToNextTask({ tasks, employees, employeeId }) {
  const nextEmployees = employees.map((e) => ({ ...e }));
  const e = nextEmployees.find((x) => x.id === employeeId);
  if (!e) return { tasks, employees, movedTo: null };
  if (e.absent) return { tasks, employees, movedTo: null };

  const counts = new Map(tasks.map((t) => [t.id, countAssigned(nextEmployees, t.id)]));
  const deficits = tasks
    .filter((t) => (t.minStaff || 0) > 0)
    .map((t) => ({ taskId: t.id, need: Math.max(0, (t.minStaff || 0) - (counts.get(t.id) || 0)) }))
    .filter((d) => d.need > 0)
    .map((d) => d.taskId);

  // prefer nextTaskIds that are currently in deficit
  const ordered = uniq([...(e.nextTaskIds || []), ...tasks.map((t) => t.id)]);
  const preferred = ordered.filter((tid) => isEligible(e, tid));

  const pick = preferred.find((tid) => deficits.includes(tid)) || preferred[0] || null;
  const from = e.currentTaskId;
  e.currentTaskId = pick;

  return { tasks, employees: nextEmployees, movedTo: pick, from };
}

function ensureEligibilityIntegrity(tasks, employees) {
  // If tasks changed, ensure each employee eligible list and next list only contains existing tasks.
  const taskIds = new Set(tasks.map((t) => t.id));
  const fixed = employees.map((e) => {
    const eligible = (e.eligibleTaskIds || []).filter((id) => taskIds.has(id));
    const next = (e.nextTaskIds || []).filter((id) => taskIds.has(id));
    const current = e.currentTaskId && taskIds.has(e.currentTaskId) ? e.currentTaskId : null;
    return { ...e, eligibleTaskIds: eligible, nextTaskIds: next, currentTaskId: current };
  });
  return fixed;
}

function pillClass(kind) {
  switch (kind) {
    case "deficit":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "ok":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "buffer":
      return "bg-slate-50 text-slate-700 border-slate-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function MultiSelectChips({ options, selected, onChange, placeholder = "Velg..." }) {
  const sel = new Set(selected || []);
  const toggle = (id) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(selected || []).length === 0 ? (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        ) : (
          (selected || []).map((id) => {
            const opt = options.find((o) => o.value === id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted"
              >
                <span>{opt?.label ?? id}</span>
                <span className="text-muted-foreground">×</span>
              </button>
            );
          })
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm hover:bg-muted ${
              sel.has(o.value) ? "border-emerald-300 bg-emerald-50" : "" 
            }`}
          >
            <span className="truncate">{o.label}</span>
            <span className="text-xs text-muted-foreground">{sel.has(o.value) ? "Valgt" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmployeeDialog({ mode, open, onOpenChange, tasks, initial, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [role, setRole] = useState(initial?.role || "");
  const [absent, setAbsent] = useState(!!initial?.absent);
  const [currentTaskId, setCurrentTaskId] = useState(initial?.currentTaskId || "");
  const [eligibleTaskIds, setEligibleTaskIds] = useState(initial?.eligibleTaskIds || tasks.map((t) => t.id));
  const [nextTaskIds, setNextTaskIds] = useState(initial?.nextTaskIds || []);

  useEffect(() => {
    setName(initial?.name || "");
    setRole(initial?.role || "");
    setAbsent(!!initial?.absent);
    setCurrentTaskId(initial?.currentTaskId || "");
    setEligibleTaskIds(initial?.eligibleTaskIds || tasks.map((t) => t.id));
    setNextTaskIds(initial?.nextTaskIds || []);
  }, [open, initial, tasks]);

  const taskOptions = useMemo(
    () => tasks.map((t) => ({ value: t.id, label: t.name })),
    [tasks]
  );

  const canSave = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Rediger ansatt" : "Ny ansatt"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Navn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fornavn Etternavn" />
          </div>
          <div className="space-y-2">
            <Label>Rolle</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Eks: Senior depotrådgiver" />
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3 sm:col-span-2">
            <div className="space-y-0.5">
              <div className="font-medium">Fravær</div>
              <div className="text-sm text-muted-foreground">Marker ansatt som utilgjengelig (tas ut av bemanning).</div>
            </div>
            <Switch checked={absent} onCheckedChange={setAbsent} />
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Aktiv oppgave</Label>
              <span className="text-xs text-muted-foreground">(kan stå tom)</span>
            </div>
            <Select value={currentTaskId || "__none__"} onValueChange={(v) => setCurrentTaskId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Velg oppgave" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Ingen</SelectItem>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Når fravær er aktivt, ignoreres aktiv oppgave i bemanningsreglene.</p>
          </div>

          <div className="space-y-2">
            <Label>"Neste oppgaver" (prioritert)</Label>
            <p className="text-xs text-muted-foreground">Brukes når du trykker «Ferdig → Neste», og som preferanse ved auto-balansering.</p>
            <MultiSelectChips options={taskOptions} selected={nextTaskIds} onChange={setNextTaskIds} placeholder="Klikk for å legge til neste-oppgaver" />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label>Kompetanse / hvilke oppgaver ansatt kan settes på</Label>
            <p className="text-xs text-muted-foreground">Auto-balansering flytter kun ansatte til oppgaver de er «eligible» for.</p>
            <MultiSelectChips options={taskOptions} selected={eligibleTaskIds} onChange={setEligibleTaskIds} placeholder="Velg oppgaver ansatt kan jobbe med" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={() =>
              onSave({
                id: initial?.id || uid("e"),
                name: name.trim(),
                role: role.trim(),
                absent,
                currentTaskId: currentTaskId || null,
                nextTaskIds: uniq(nextTaskIds),
                eligibleTaskIds: uniq(eligibleTaskIds),
              })
            }
            disabled={!canSave}
          >
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({ mode, open, onOpenChange, initial, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [minStaff, setMinStaff] = useState(String(initial?.minStaff ?? 0));
  const [description, setDescription] = useState(initial?.description || "");
  const [isBuffer, setIsBuffer] = useState(!!initial?.isBuffer);

  useEffect(() => {
    setName(initial?.name || "");
    setMinStaff(String(initial?.minStaff ?? 0));
    setDescription(initial?.description || "");
    setIsBuffer(!!initial?.isBuffer);
  }, [open, initial]);

  const canSave = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Rediger oppgave" : "Ny oppgave"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Navn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eks: Avstemming" />
          </div>

          <div className="space-y-2">
            <Label>Minimum antall ansatte</Label>
            <Input
              value={minStaff}
              onChange={(e) => setMinStaff(e.target.value)}
              inputMode="numeric"
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">Sett 0 for «buffer»-oppgaver der ingen trenger å være fast, men hvor folk kan gå over på når de blir ferdige.</p>
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="space-y-0.5">
              <div className="font-medium">Buffer/valgfri</div>
              <div className="text-sm text-muted-foreground">Prioriteres som donor ved auto-balansering.</div>
            </div>
            <Switch checked={isBuffer} onCheckedChange={setIsBuffer} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Beskrivelse</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kort forklaring (valgfritt)" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={() =>
              onSave({
                id: initial?.id || uid("t"),
                name: name.trim(),
                minStaff: clamp(normalizeInt(minStaff, 0), 0, 999),
                description: description.trim(),
                isBuffer,
              })
            }
            disabled={!canSave}
          >
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatPill({ kind, icon: Icon, title, value, sub }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${pillClass(kind)}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          <div className="font-medium">{title}</div>
        </div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function TaskRow({ task, assigned, minStaff, deficit, onEdit, onDelete }) {
  const kind = deficit > 0 ? "deficit" : task.isBuffer || minStaff === 0 ? "buffer" : "ok";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold">{task.name}</div>
          {task.isBuffer || minStaff === 0 ? <Badge variant="secondary">Buffer</Badge> : null}
          {deficit > 0 ? (
            <Badge className="bg-rose-600 hover:bg-rose-600">Underbemannet</Badge>
          ) : (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">OK</Badge>
          )}
        </div>
        {task.description ? <div className="mt-1 text-sm text-muted-foreground truncate">{task.description}</div> : null}
      </div>

      <div className="flex items-center gap-3">
        <div className={`rounded-xl border px-3 py-2 text-sm ${pillClass(kind)}`}>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="tabular-nums">
              {assigned} / {minStaff}
            </span>
          </div>
          {deficit > 0 ? <div className="mt-0.5 text-xs">Mangler: {deficit}</div> : <div className="mt-0.5 text-xs">Dekket</div>}
        </div>
        <Button variant="outline" size="icon" onClick={onEdit} title="Rediger">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={onDelete} title="Slett">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function EmployeeRow({ employee, tasksById, onToggleAbsent, onChangeTask, onFinishNext, onEdit, onDelete }) {
  const currentTask = employee.currentTaskId ? tasksById.get(employee.currentTaskId) : null;
  const nextNames = (employee.nextTaskIds || [])
    .map((id) => tasksById.get(id)?.name)
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div className="rounded-2xl border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-base font-semibold">{employee.name}</div>
            {employee.role ? <Badge variant="secondary">{employee.role}</Badge> : null}
            {employee.absent ? <Badge className="bg-slate-600 hover:bg-slate-600">Fravær</Badge> : null}
          </div>

          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Aktiv:</span>
              <span className="font-medium">{employee.absent ? "—" : currentTask?.name || "Ingen"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Neste:</span>
              <span className="font-medium">{nextNames.length ? nextNames.join(" → ") : "(ikke satt)"}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <UserX className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Fravær</span>
            <Switch checked={employee.absent} onCheckedChange={() => onToggleAbsent(employee.id)} />
          </div>

          <Select
            value={employee.currentTaskId || "__none__"}
            onValueChange={(v) => onChangeTask(employee.id, v === "__none__" ? null : v)}
            disabled={employee.absent}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Sett aktiv oppgave" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Ingen</SelectItem>
              {Array.from(tasksById.values()).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => onFinishNext(employee.id)} disabled={employee.absent} className="gap-2">
            Ferdig <ArrowRight className="h-4 w-4" />
          </Button>

          <Button variant="outline" size="icon" onClick={onEdit} title="Rediger">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onDelete} title="Slett">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(loadState);

  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDialogMode, setTaskDialogMode] = useState("create");
  const [taskDialogInitial, setTaskDialogInitial] = useState(null);

  const [empDialogOpen, setEmpDialogOpen] = useState(false);
  const [empDialogMode, setEmpDialogMode] = useState("create");
  const [empDialogInitial, setEmpDialogInitial] = useState(null);

  const [lastChanges, setLastChanges] = useState([]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const tasksById = useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);

  const metrics = useMemo(() => {
    const available = state.employees.filter((e) => !e.absent).length;
    const absent = state.employees.filter((e) => e.absent).length;

    const perTask = state.tasks.map((t) => {
      const assigned = countAssigned(state.employees, t.id);
      const min = normalizeInt(t.minStaff, 0);
      const deficit = Math.max(0, min - assigned);
      return { ...t, assigned, min, deficit };
    });

    const totalDeficit = perTask.reduce((sum, t) => sum + t.deficit, 0);
    const under = perTask.filter((t) => t.deficit > 0).length;

    return { available, absent, perTask, totalDeficit, under };
  }, [state]);

  const runAutoBalance = () => {
    const result = autoBalance(state);
    setState({ tasks: result.tasks, employees: result.employees });
    setLastChanges(result.changes);
  };

  const toggleAbsent = (employeeId) => {
    setState((prev) => {
      const employees = prev.employees.map((e) => (e.id === employeeId ? { ...e, absent: !e.absent } : e));
      const balanced = autoBalance({ tasks: prev.tasks, employees }).employees;
      setLastChanges([{ employeeId, reason: "Fravær endret" }, ...[]]);
      return { ...prev, employees: balanced };
    });
  };

  const setEmployeeTask = (employeeId, taskId) => {
    setState((prev) => {
      const employees = prev.employees.map((e) => (e.id === employeeId ? { ...e, currentTaskId: taskId } : e));
      const balanced = autoBalance({ tasks: prev.tasks, employees }).employees;
      setLastChanges([{ employeeId, reason: "Manuell endring" }]);
      return { ...prev, employees: balanced };
    });
  };

  const finishAndNext = (employeeId) => {
    setState((prev) => {
      const moved = moveEmployeeToNextTask({ tasks: prev.tasks, employees: prev.employees, employeeId });
      const balanced = autoBalance({ tasks: prev.tasks, employees: moved.employees }).employees;
      setLastChanges([
        {
          employeeId,
          from: moved.from,
          to: moved.movedTo,
          reason: "Ferdig → Neste",
        },
      ]);
      return { ...prev, employees: balanced };
    });
  };

  const upsertEmployee = (emp) => {
    setState((prev) => {
      const exists = prev.employees.some((e) => e.id === emp.id);
      const employees = exists ? prev.employees.map((e) => (e.id === emp.id ? emp : e)) : [...prev.employees, emp];
      const fixed = ensureEligibilityIntegrity(prev.tasks, employees);
      const balanced = autoBalance({ tasks: prev.tasks, employees: fixed }).employees;
      setLastChanges([{ employeeId: emp.id, reason: exists ? "Ansatt oppdatert" : "Ansatt lagt til" }]);
      return { ...prev, employees: balanced };
    });
  };

  const deleteEmployee = (id) => {
    setState((prev) => {
      const employees = prev.employees.filter((e) => e.id !== id);
      const balanced = autoBalance({ tasks: prev.tasks, employees }).employees;
      setLastChanges([{ employeeId: id, reason: "Ansatt slettet" }]);
      return { ...prev, employees: balanced };
    });
  };

  const upsertTask = (task) => {
    setState((prev) => {
      const exists = prev.tasks.some((t) => t.id === task.id);
      const tasks = exists ? prev.tasks.map((t) => (t.id === task.id ? task : t)) : [...prev.tasks, task];
      const employeesFixed = ensureEligibilityIntegrity(tasks, prev.employees);
      const balanced = autoBalance({ tasks, employees: employeesFixed }).employees;
      setLastChanges([{ taskId: task.id, reason: exists ? "Oppgave oppdatert" : "Oppgave lagt til" }]);
      return { tasks, employees: balanced };
    });
  };

  const deleteTask = (id) => {
    setState((prev) => {
      const tasks = prev.tasks.filter((t) => t.id !== id);
      const employees = prev.employees.map((e) => ({
        ...e,
        currentTaskId: e.currentTaskId === id ? null : e.currentTaskId,
        nextTaskIds: (e.nextTaskIds || []).filter((x) => x !== id),
        eligibleTaskIds: (e.eligibleTaskIds || []).filter((x) => x !== id),
      }));
      const fixed = ensureEligibilityIntegrity(tasks, employees);
      const balanced = autoBalance({ tasks, employees: fixed }).employees;
      setLastChanges([{ taskId: id, reason: "Oppgave slettet" }]);
      return { tasks, employees: balanced };
    });
  };

  const resetDemo = () => {
    setState(seed);
    setLastChanges([{ reason: "Tilbakestilt til demo-data" }]);
  };

  const openCreateTask = () => {
    setTaskDialogMode("create");
    setTaskDialogInitial(null);
    setTaskDialogOpen(true);
  };

  const openEditTask = (t) => {
    setTaskDialogMode("edit");
    setTaskDialogInitial(t);
    setTaskDialogOpen(true);
  };

  const openCreateEmployee = () => {
    setEmpDialogMode("create");
    setEmpDialogInitial(null);
    setEmpDialogOpen(true);
  };

  const openEditEmployee = (e) => {
    setEmpDialogMode("edit");
    setEmpDialogInitial(e);
    setEmpDialogOpen(true);
  };

  const understaffedTasks = metrics.perTask.filter((t) => t.deficit > 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Oppgave- og bemanningsoversikt</h1>
              <p className="text-sm text-muted-foreground">
                Prototype: hold oversikt over ansatte, aktive oppgaver, «neste oppgaver» og automatisk omfordeling ved fravær / minimumsbemanning.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runAutoBalance} className="gap-2">
                <Wand2 className="h-4 w-4" /> Auto-balanser
              </Button>
              <Button variant="outline" onClick={resetDemo} className="gap-2">
                <RefreshCcw className="h-4 w-4" /> Reset demo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatPill kind="ok" icon={Users} title="Tilgjengelige" value={metrics.available} sub="Ansatte uten fravær" />
            <StatPill kind="buffer" icon={UserX} title="Fravær" value={metrics.absent} sub="Tas ut av bemanning" />
            <StatPill
              kind={metrics.totalDeficit > 0 ? "deficit" : "ok"}
              icon={metrics.totalDeficit > 0 ? AlertTriangle : CheckCircle2}
              title="Underbemanning" value={metrics.totalDeficit}
              sub={metrics.totalDeficit > 0 ? `${metrics.under} oppgaver under min.` : "Alle min.-krav dekket"}
            />
          </div>
        </motion.div>

        <AnimatePresence>
          {understaffedTasks.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <Alert className="rounded-2xl border-rose-200 bg-rose-50">
                <AlertTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Underbemanning oppdaget</AlertTitle>
                <AlertDescription>
                  {understaffedTasks.map((t) => (
                    <span key={t.id} className="mr-2 inline-flex items-center gap-1">
                      <strong>{t.name}</strong>: mangler {t.deficit}
                    </span>
                  ))}
                  <div className="mt-2 text-sm">Tips: trykk «Auto-balanser» – eller juster kompetanse/neste-oppgaver per ansatt.</div>
                </AlertDescription>
              </Alert>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Tabs defaultValue="oppgaver" className="space-y-4">
          <TabsList className="rounded-2xl">
            <TabsTrigger value="oppgaver" className="gap-2"><ClipboardList className="h-4 w-4" /> Oppgaver</TabsTrigger>
            <TabsTrigger value="ansatte" className="gap-2"><Users className="h-4 w-4" /> Ansatte</TabsTrigger>
            <TabsTrigger value="logg" className="gap-2"><RefreshCcw className="h-4 w-4" /> Endringslogg</TabsTrigger>
          </TabsList>

          <TabsContent value="oppgaver" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Oppgaver og minimumsbemanning</CardTitle>
                <div className="flex items-center gap-2">
                  <Button onClick={openCreateTask} className="gap-2"><Plus className="h-4 w-4" /> Ny oppgave</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {metrics.perTask.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Ingen oppgaver enda.</div>
                ) : (
                  metrics.perTask
                    .slice()
                    .sort((a, b) => (b.deficit - a.deficit) || (b.min - a.min) || a.name.localeCompare(b.name))
                    .map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        assigned={t.assigned}
                        minStaff={t.min}
                        deficit={t.deficit}
                        onEdit={() => openEditTask(t)}
                        onDelete={() => deleteTask(t.id)}
                      />
                    ))
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Hvordan appen tenker (kort)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div>• Oppgaver med <strong>min &gt; 0</strong> må ha minst så mange tilgjengelige ansatte.</div>
                <div>• Ved fravær flyttes ansatte automatisk slik at min-krav forsøkes dekket.</div>
                <div>• Systemet tar først fra <strong>buffer-oppgaver</strong> (min=0 / «buffer»), deretter fra oppgaver som har <strong>overskudd</strong> (over min).</div>
                <div>• Flytting skjer kun til oppgaver den ansatte har kompetanse for, og preferanse styres av «neste oppgaver».</div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ansatte" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Ansatte og oppgavefordeling</CardTitle>
                <div className="flex items-center gap-2">
                  <Button onClick={openCreateEmployee} className="gap-2"><Plus className="h-4 w-4" /> Ny ansatt</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {state.employees.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Ingen ansatte enda.</div>
                ) : (
                  state.employees
                    .slice()
                    .sort((a, b) => {
                      // absent last
                      if (a.absent !== b.absent) return a.absent ? 1 : -1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((e) => (
                      <EmployeeRow
                        key={e.id}
                        employee={e}
                        tasksById={tasksById}
                        onToggleAbsent={toggleAbsent}
                        onChangeTask={setEmployeeTask}
                        onFinishNext={finishAndNext}
                        onEdit={() => openEditEmployee(e)}
                        onDelete={() => deleteEmployee(e.id)}
                      />
                    ))
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Tips for praksis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div>• Bruk «kompetanse» per ansatt til å hindre at systemet flytter folk til feil oppgave.</div>
                <div>• Sett «neste oppgaver» for å speile planlagt arbeidsflyt når noen blir ferdig.</div>
                <div>• Lag egne buffer-oppgaver for forbedringsarbeid, opplæring, backlog eller annet arbeid uten min-krav.</div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logg" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Siste endringer</CardTitle>
              </CardHeader>
              <CardContent>
                {lastChanges.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Ingen endringer logget enda. Prøv «Auto-balanser» eller endre fravær.</div>
                ) : (
                  <div className="space-y-2">
                    {lastChanges.slice(0, 10).map((c, idx) => {
                      const emp = c.employeeId ? state.employees.find((e) => e.id === c.employeeId) : null;
                      const from = c.from ? tasksById.get(c.from)?.name : c.from === null ? "Ingen" : null;
                      const to = c.to ? tasksById.get(c.to)?.name : c.to === null ? "Ingen" : null;
                      return (
                        <div key={idx} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{c.reason || "Endring"}</div>
                            <Badge variant="secondary">{new Date().toLocaleString("nb-NO")}</Badge>
                          </div>
                          {emp ? <div className="text-muted-foreground">Ansatt: <span className="font-medium text-foreground">{emp.name}</span></div> : null}
                          {from || to ? (
                            <div className="text-muted-foreground">
                              {from ?? "—"} <ArrowRight className="inline h-4 w-4" /> {to ?? "—"}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Datasikkerhet (prototype)</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <div>• Denne prototypen lagrer data lokalt i nettleseren (localStorage).</div>
                <div>• For produksjon anbefales Dataverse / SharePoint-lister + tilgangsstyring (AAD) og audit-logg.</div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <TaskDialog
          mode={taskDialogMode}
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          initial={taskDialogInitial}
          onSave={(t) => {
            upsertTask(t);
            setTaskDialogOpen(false);
          }}
        />

        <EmployeeDialog
          mode={empDialogMode}
          open={empDialogOpen}
          onOpenChange={setEmpDialogOpen}
          tasks={state.tasks}
          initial={empDialogInitial}
          onSave={(e) => {
            upsertEmployee(e);
            setEmpDialogOpen(false);
          }}
        />

        <footer className="pb-8 text-xs text-muted-foreground">
          Prototype v1 – laget for å demonstrere logikk for minimumsbemanning, buffer-oppgaver og fraværshåndtering.
        </footer>
      </div>
    </div>
  );
}
