import { pageMetadata } from "@/lib/seo/metadata";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { GuidedChat } from "../_components/GuidedChat";

export const metadata = pageMetadata({
  title: "Chat guiado",
  description: "Una conversación guiada con NEX: diagnóstico del negocio y traspaso preparado para el equipo.",
  path: "/nex/chat",
});

export default function GuidedChatPage() {
  return <GuidedChat pack={NOVA_DRAFT_PACK} paceMs={1} />;
}
