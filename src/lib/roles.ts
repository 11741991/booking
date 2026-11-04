export type Role = "hunter" | "closer" | "admin" | "rop";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  is_active: boolean;
  auth_user_id: string | null;
};

export const ROLE_LABELS: Record<Role, string> = {
  hunter: "Хантер",
  closer: "Клоузер",
  rop: "РОП",
  admin: "Админ",
};
