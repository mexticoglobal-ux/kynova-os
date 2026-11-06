import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadServerSession } from "@/lib/auth/session";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Crea tu empresa", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const state = await loadServerSession();
  if (state.kind === "demo" || state.kind === "anonymous") redirect(state.kind === "demo" ? "/dashboard" : "/login");
  if (state.kind === "unavailable") redirect("/login");
  if (state.active) redirect("/dashboard");
  return <OnboardingForm email={state.session.email} />;
}
