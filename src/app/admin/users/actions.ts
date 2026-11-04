"use server";
import { revalidatePath } from "next/cache";
import { requireRole, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ROLES: Role[] = ["hunter", "closer", "rop", "admin"];

function parseRoles(fd: FormData): Role[] {
  return ROLES.filter((r) => fd.get(`role_${r}`) === "on");
}

export async function createUser(_: unknown, fd: FormData) {
  await requireRole("admin");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const roles = parseRoles(fd);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Некорректный e-mail" };
  if (!name) return { error: "Укажите имя" };
  if (roles.length === 0) return { error: "Выберите хотя бы одну роль" };

  const supabase = await createClient();
  const { error } = await supabase.from("users").insert({ email, name, roles });
  if (error) {
    if (error.code === "23505") return { error: "Такой e-mail уже добавлен" };
    return { error: error.message };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUser(_: unknown, fd: FormData) {
  await requireRole("admin");
  const id = String(fd.get("id"));
  const name = String(fd.get("name") ?? "").trim();
  const roles = parseRoles(fd);
  if (!name) return { error: "Укажите имя" };
  if (roles.length === 0) return { error: "Выберите хотя бы одну роль" };

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ name, roles }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserActive(id: string, isActive: boolean) {
  const me = await requireRole("admin");
  if (me.id === id && !isActive) return { error: "Нельзя деактивировать самого себя" };
  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}
