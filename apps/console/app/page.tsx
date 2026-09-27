import { RoleSwitcher } from "@/components/role-switcher"
import { getSessionRole } from "@/lib/session"

export default async function Page() {
  const role = await getSessionRole()

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="scroll-m-20 text-3xl font-semibold tracking-tight">VisitProof</h1>
        <p className="text-muted-foreground">
          Proof of presence for home care, from the doorbell already at the door. Choose a role to
          sign in with one click. Local demo data only, no account needed.
        </p>
      </div>
      <RoleSwitcher current={role} />
    </main>
  )
}
