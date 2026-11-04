import { requireRole, type AppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage() {
  const me = await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id,email,name,roles,is_active,auth_user_id")
    .order("is_active", { ascending: false })
    .order("name");
  const users = (data ?? []) as AppUser[];

  return (
    <AppShell user={me}>
      <h1 className="text-lg font-semibold mb-4">Сотрудники</h1>
      <UsersTable users={users} meId={me.id} />
    </AppShell>
  );
}
