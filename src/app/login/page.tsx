import { LoginButton } from "./login-button";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="card w-full max-w-sm text-center space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Букинг встреч</h1>
          <p className="text-sm text-gray-500 mt-1">Запись клиентов на встречи</p>
        </div>
        <LoginButton />
        {error && <p className="text-sm text-red-600">Не удалось войти. Попробуйте ещё раз.</p>}
      </div>
    </main>
  );
}
