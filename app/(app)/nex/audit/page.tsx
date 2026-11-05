import { pageMetadata } from "@/lib/seo/metadata";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { AuditFlow } from "../_components/AuditFlow";

export const metadata = pageMetadata({
  title: "Business Audit",
  description: "Un diagnóstico guiado por NEX: dónde está su negocio y qué hacer primero.",
  path: "/nex/audit",
});

export default function AuditPage() {
  return <AuditFlow pack={NOVA_DRAFT_PACK} />;
}
