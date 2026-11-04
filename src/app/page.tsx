import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold">Здравствуйте, {user.name}</h1>
        <p className="text-sm text-gray-600">
          Ваши роли: {user.roles.map((r) => ROLE_LABELS[r]).join(", ") || "не назначены"}
        </p>
        <p className="text-sm text-gray-500">
          Сетка слотов и бронирование появятся на следующих этапах.
        </p>
      </div>
    </AppShell>
  );
}
