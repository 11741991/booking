import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import type { Role, AppUser } from "@/lib/roles";
export type { Role, AppUser } from "@/lib/roles";
export { ROLE_LABELS } from "@/lib/roles";

/** Текущий сотрудник. Если не залогинен → /login; залогинен, но не в списке → /no-access */
export async function requireUser(): Promise<AppUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("link_auth_user");
  const appUser = (Array.isArray(data) ? data[0] : data) as AppUser | null;
  if (!appUser || !appUser.is_active) redirect("/no-access");
  return appUser;
}

export async function requireRole(...roles: Role[]): Promise<AppUser> {
  const user = await requireUser();
  if (!roles.some((r) => user.roles.includes(r))) redirect("/");
  return user;
}
