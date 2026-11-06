import type { Metadata } from "next";
import { getSupabaseSpikeConfig } from "@/lib/db/supabase-spike-config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Iniciar sesión", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm configured={Boolean(getSupabaseSpikeConfig())} next={next ?? null} />;
}
