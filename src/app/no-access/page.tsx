import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function NoAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="card w-full max-w-sm text-center space-y-4">
        <h1 className="text-xl font-semibold">Доступ не выдан</h1>
        <p className="text-sm text-gray-600">
          Аккаунт <b>{user?.email}</b> не добавлен в систему. Попросите администратора добавить ваш
          e-mail.
        </p>
        <SignOutButton className="btn-secondary w-full" />
      </div>
    </main>
  );
}
