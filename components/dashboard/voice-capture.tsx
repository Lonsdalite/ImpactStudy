"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { extractVoice, saveVoice } from "@/lib/actions/voice";
import type { VoiceSignature } from "@/lib/voice-types";

const EMPTY: VoiceSignature = {
  tutorName: "",
  register: "",
  openers: [],
  neverUse: [],
  patterns: [],
};

const toLines = (a: string[]) => a.join("\n");
const fromLines = (s: string) => s.split("\n");

export function VoiceCapture({
  initialVoice,
}: {
  initialVoice: VoiceSignature | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [samples, setSamples] = useState("");
  const [voice, setVoice] = useState<VoiceSignature>(initialVoice ?? EMPTY);
  const hasVoice =
    voice.register.trim().length > 0 || voice.patterns.length > 0;

  function analyse() {
    if (!samples.trim()) {
      toast.error("Paste a few of your messages first");
      return;
    }
    startTransition(async () => {
      const res = await extractVoice(samples);
      if (res.ok && res.voice) {
        setVoice(res.voice);
        toast.success("Draft voice ready — review and edit below, then save");
      } else {
        toast.error(res.error ?? "Couldn't analyse the messages");
      }
    });
  }

  function save() {
    if (!voice.register.trim()) {
      toast.error("Add at least a register/tone before saving");
      return;
    }
    startTransition(async () => {
      const res = await saveVoice(voice);
      if (res.ok) {
        toast.success("Voice saved — your practice now writes in this voice");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't save");
      }
    });
  }

  const field =
    "mt-1 block w-full rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-plum focus:outline-none";

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/* Step 1: capture from samples */}
      <div className="rounded-2xl border border-brand-mist bg-white p-5">
        <h2 className="text-sm font-medium text-brand-plum">
          1. Paste a few of your real messages
        </h2>
        <p className="mt-1 text-xs text-brand-ink/55">
          Notes to students or parents work best. The AI will draft your voice
          from them — you stay in control and edit before saving.
        </p>
        <textarea
          value={samples}
          onChange={(e) => setSamples(e.target.value)}
          rows={5}
          placeholder="Hi Amara! Lovely effort this week, your ratios are really coming along…"
          className={`${field} resize-y`}
        />
        <button
          type="button"
          onClick={analyse}
          disabled={isPending}
          className="mt-3 rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {isPending ? "Analysing…" : "Analyse my voice"}
        </button>
      </div>

      {/* Step 2: review + edit + save */}
      <div className="rounded-2xl border border-brand-mist bg-white p-5">
        <h2 className="text-sm font-medium text-brand-plum">
          2. Review your voice signature
        </h2>
        <p className="mt-1 text-xs text-brand-ink/55">
          Edit anything that isn&apos;t quite you. One item per line for the
          lists.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-brand-ink/60">
            Your name
            <input
              value={voice.tutorName}
              onChange={(e) => setVoice({ ...voice, tutorName: e.target.value })}
              placeholder="Fatima"
              className={field}
            />
          </label>
          <label className="text-xs text-brand-ink/60">
            Tone / register
            <input
              value={voice.register}
              onChange={(e) => setVoice({ ...voice, register: e.target.value })}
              placeholder="warm, direct, slightly informal"
              className={field}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-brand-ink/60">
            How you greet (use {"{name}"})
            <textarea
              value={toLines(voice.openers)}
              onChange={(e) =>
                setVoice({ ...voice, openers: fromLines(e.target.value) })
              }
              rows={3}
              className={`${field} resize-y`}
            />
          </label>
          <label className="text-xs text-brand-ink/60">
            Things you&apos;d never say
            <textarea
              value={toLines(voice.neverUse)}
              onChange={(e) =>
                setVoice({ ...voice, neverUse: fromLines(e.target.value) })
              }
              rows={3}
              className={`${field} resize-y`}
            />
          </label>
        </div>

        <label className="mt-4 block text-xs text-brand-ink/60">
          Your style patterns
          <textarea
            value={toLines(voice.patterns)}
            onChange={(e) =>
              setVoice({ ...voice, patterns: fromLines(e.target.value) })
            }
            rows={6}
            className={`${field} resize-y`}
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={isPending || !hasVoice}
          className="mt-4 rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          Save voice
        </button>
      </div>
    </div>
  );
}
