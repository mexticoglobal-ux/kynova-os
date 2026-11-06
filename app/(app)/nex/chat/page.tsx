import { pageMetadata } from "@/lib/seo/metadata";
import { ConnectedGuidedChat } from "../_components/ConnectedGuidedChat";

export const metadata = pageMetadata({
  title: "Chat guiado",
  description: "Una conversación guiada con NEX: diagnóstico del negocio y traspaso preparado para el equipo.",
  path: "/nex/chat",
});

export default function GuidedChatPage() {
  return <ConnectedGuidedChat />;
}
