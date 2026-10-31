"use client";

import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { I18nProvider } from "@/components/i18n/I18nProvider";

// `strict` makes any full `motion.*` import fail fast: components must use the lightweight `m.*`.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </LazyMotion>
    </I18nProvider>
  );
}
