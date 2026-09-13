import React, { useEffect, useRef, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Sparkles, Send, Bot, User, AlertTriangle, ShieldCheck, Loader2, RefreshCw, Lock } from 'lucide-react';
import { FLAG_LABELS, AI_DATA_FLAGS } from '../../types';
import { cn } from '../../lib/utils';

type Msg = { role: 'user' | 'ai'; text: string; degraded?: boolean };

const SUGGESTIONS = [
  "What are today's sales?",
  'How much cash is in the register?',
  'Which items are low in stock?',
  'Who are my top customers?',
  'Total purchases this month?',
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

  // Data domains this role's AI is allowed to read (drives the "what I can see" chips).
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
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Beta AI</h1>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-gradient-to-r from-violet-50 to-fuchsia-50 text-fuchsia-700 border border-fuchsia-200">
                Beta
              </span>
            </div>
            <p className="text-xs text-slate-500">Ask business questions in plain words — answers come from your live data.</p>
          </div>
        </div>
        {status?.private && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title="Runs on your own server — data never leaves it">
            <Lock className="h-3 w-3" /> Private · on your server
          </span>
        )}
        <button
          onClick={loadStatus}
          className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          title="Refresh engine status"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Engine status / not-connected banner */}
      {status && !status.connected && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <p className="font-semibold">AI engine not connected</p>
            <p className="mt-0.5">{status.message}</p>
          </div>
        </div>
      )}

      {/* Access scope chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {currentUser.role} · AI can read:
        </span>
        {allowedDomains.length === 0 ? (
          <span className="text-[11px] text-slate-400">No data domains enabled — ask the CEO to grant access.</span>
        ) : (
          allowedDomains.map((f) => (
            <span key={f} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              {FLAG_LABELS[f]?.replace(/^AI can read /, '') || f}
            </span>
          ))
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center mb-3">
              <Bot className="h-7 w-7 text-fuchsia-600" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Ask me anything about your business</p>
            <p className="text-xs text-slate-400 mt-1 mb-4 max-w-sm">
              I understand everyday language (typos are fine). I only answer business questions and use real figures from your data.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-slate-50 hover:bg-violet-50 text-slate-600 hover:text-violet-700 border border-slate-200 hover:border-violet-200 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'ai' && (
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed',
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : m.degraded
                  ? 'bg-amber-50 text-amber-800 border border-amber-200 rounded-bl-md'
                  : 'bg-slate-100 text-slate-800 rounded-bl-md'
              )}
            >
              {m.text}
            </div>
            {m.role === 'user' && (
              <div className="h-8 w-8 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex gap-2.5 justify-start">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="bg-slate-100 rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          rows={1}
          placeholder="Ask a business question…  (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 max-h-32"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-[42px] px-4 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95 transition-opacity shrink-0"
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </form>
      <p className="mt-2 text-[10px] text-slate-400 text-center">
        Beta AI answers business questions only and never invents figures. Responses may occasionally be imperfect — verify important numbers.
      </p>
    </div>
  );
};
