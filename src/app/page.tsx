import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { navFor } from "@/components/app-shell";

export default async function HomePage() {
  const user = await requireUser();
  const first = navFor(user)[0];
  if (first) redirect(first.href);
  redirect("/no-access");
}
