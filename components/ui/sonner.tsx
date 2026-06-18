"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:border-brand-mist group-[.toaster]:text-brand-ink group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-brand-ink/65",
          actionButton:
            "group-[.toast]:bg-brand-plum group-[.toast]:text-brand-cream",
          cancelButton:
            "group-[.toast]:bg-brand-mist group-[.toast]:text-brand-ink",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
