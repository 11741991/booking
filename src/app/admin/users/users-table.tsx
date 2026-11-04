"use client";
import { useActionState, useState, useTransition } from "react";
import type { AppUser, Role } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";
import { createUser, updateUser, setUserActive } from "./actions";

const ROLES: Role[] = ["hunter", "closer", "rop", "admin"];
type ActionState = { error?: string; ok?: boolean } | null;

function RoleCheckboxes({ defaults }: { defaults?: Role[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {ROLES.map((r) => (
        <label key={r} className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name={`role_${r}`} defaultChecked={defaults?.includes(r)} />
          {ROLE_LABELS[r]}
        </label>
      ))}
    </div>
  );
}

function AddUserForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createUser, null);
  return (
    <form action={action} className="card space-y-3" key={state?.ok ? Date.now() : "form"}>
      <h2 className="font-medium">Добавить сотрудника</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Имя" className="input" required />
        <input name="email" type="email" placeholder="email@company.kz" className="input" required />
      </div>
      <RoleCheckboxes />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Сохраняем…" : "Добавить"}
      </button>
    </form>
  );
}

function EditUserForm({ user, onDone }: { user: AppUser; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const res = await updateUser(prev, fd);
      if (res.ok) onDone();
      return res;
    },
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={user.id} />
      <input name="name" defaultValue={user.name} className="input" required />
      <p className="text-xs text-gray-500">{user.email}</p>
      <RoleCheckboxes defaults={user.roles} />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          Сохранить
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function UserRow({ user, meId }: { user: AppUser; meId: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggleActive() {
    const next = !user.is_active;
    if (!next && !confirm(`Деактивировать ${user.name}? Доступ в систему будет закрыт.`)) return;
    start(async () => {
      const res = await setUserActive(user.id, next);
      setErr(res.error ?? null);
    });
  }

  return (
    <div className={`card ${user.is_active ? "" : "opacity-60"}`}>
      {editing ? (
        <EditUserForm user={user} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium flex items-center gap-2">
              {user.name}
              {!user.is_active && (
                <span className="text-xs rounded bg-gray-200 px-1.5 py-0.5">неактивен</span>
              )}
              {user.id === meId && <span className="text-xs text-gray-500">(вы)</span>}
            </div>
            <div className="text-sm text-gray-600 break-all">{user.email}</div>
            <div className="text-sm text-gray-500 mt-1">
              {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
              {!user.auth_user_id && user.is_active && (
                <span className="ml-2 text-xs text-amber-600">ещё не входил</span>
              )}
            </div>
            {err && <p className="text-sm text-red-600 mt-1">{err}</p>}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary px-3 py-1.5" onClick={() => setEditing(true)}>
              Изменить
            </button>
            {user.id !== meId && (
              <button
                className={`${user.is_active ? "btn-danger" : "btn-secondary"} px-3 py-1.5`}
                onClick={toggleActive}
                disabled={pending}
              >
                {user.is_active ? "Деактивировать" : "Активировать"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function UsersTable({ users, meId }: { users: AppUser[]; meId: string }) {
  return (
    <div className="space-y-4">
      <AddUserForm />
      <div className="space-y-2">
        {users.map((u) => (
          <UserRow key={u.id} user={u} meId={meId} />
        ))}
      </div>
    </div>
  );
}
