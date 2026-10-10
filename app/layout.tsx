import "./globals.css";
import type { Metadata } from "next";
import { site } from "@/config/site";
export const metadata:Metadata={metadataBase:new URL(site.url),title:{default:`${site.product} — ${site.tagline}`,template:`%s | ${site.name}`},
description:"Your AI executive team for faster growth through intelligent decisions and automation.",
openGraph:{title:site.product,description:site.tagline,type:"website"},twitter:{card:"summary_large_image"}};
export default function Root({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
