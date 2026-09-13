import React, { useEffect, useRef, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Sparkles, Send, AlertTriangle, ShieldCheck, Loader2, RefreshCw, Cpu } from 'lucide-react';
import { FLAG_LABELS, AI_DATA_FLAGS } from '../../types';
import { cn } from '../../lib/utils';

type Msg = { role: 'user' | 'ai'; text: string; degraded?: boolean };

const SUGGESTIONS = [
  "Today's sales",
  'Cash in register',
  'Low stock items',
  'Top customers',
  'Purchases this month',
];

export const AiAssistantView: React.FC = () => {
  const { askAi, getAiStatus, currentUser, hasFlag } = useErp();
  const [status, setStatus] = useState<{ connected: boolean; model: string; private?: boolean; message: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadStatus = async () => setStatus(await getAiStatus());
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const allowedDomains = AI_DATA_FLAGS.filter((f) => hasFlag(f));

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    const res = await askAi(question);
    setMessages((m) => [...m, { role: 'ai', text: res.answer, degraded: res.degraded }]);
    setBusy(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-5 py-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-slate-900">Beta AI</h1>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-gradient-to-r from-violet-100 to-fuchsia-100 text-fuchsia-700">Beta</span>
            </div>
            <p className="text-[11px] text-slate-500">Ask about your business — answers use your live data.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.connected && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-500">
              <Cpu className="h-3 w-3" /> {status.model || 'AI'}
            </span>
          )}
          <button onClick={loadStatus} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors" title="Refresh status">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Not-connected banner */}
      {status && !status.connected && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">{status.message}</p>
        </div>
      )}

      {/* Access scope */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {currentUser.role} can read:
        </span>
        {allowedDomains.length === 0 ? (
          <span className="text-[11px] text-slate-400">No domains enabled — ask the CEO.</span>
        ) : (
          allowedDomains.map((f) => (
            <span key={f} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {FLAG_LABELS[f]?.replace(/^AI can read /, '') || f}
            </span>
          ))
        )}
      </div>

      {/* Chat area — borderless, soft ground */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl bg-slate-50/70 p-4 space-y-4 [scrollbar-width:thin]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-10">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-fuchsia-600" />
            </div>
            <p className="text-sm font-bold text-slate-800">How can I help with your business?</p>
            <p className="text-xs text-slate-400 mt-1 mb-5 max-w-xs">
              Type in plain words — typos are fine. I answer business questions using real figures from your data.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs font-medium px-3.5 py-2 rounded-full bg-white text-slate-600 hover:text-violet-700 shadow-2xs hover:shadow-sm border border-slate-100 hover:border-violet-200 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn('flex gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'ai' && (
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-2xs',
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-3xl rounded-br-lg'
                    : m.degraded
                    ? 'bg-amber-50 text-amber-800 rounded-3xl rounded-bl-lg'
                    : 'bg-white text-slate-800 rounded-3xl rounded-bl-lg'
                )}
              >
                {m.text}
              </div>
            </div>
          ))
        )}

        {busy && (
          <div className="flex gap-2.5 justify-start">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="bg-white rounded-3xl rounded-bl-lg px-4 py-3 flex items-center gap-1.5 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-slate-300 animate-bounce" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer — rounded pill, send inside */}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3">
        <div className="flex items-end gap-2 rounded-3xl bg-white shadow-sm border border-slate-200 focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-500/15 transition-all pl-4 pr-2 py-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder="Ask a business question…"
            className="flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none max-h-32"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95 transition-opacity shrink-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-400 text-center">
          Business questions only · figures come from your live data · verify important numbers.
        </p>
      </form>
    </div>
  );
};
