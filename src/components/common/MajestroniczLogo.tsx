import React from 'react';

interface Props {
  collapsed?: boolean;
}

export const MajestroniczLogo: React.FC<Props> = ({ collapsed = false }) => {
  return (
    <div className="flex items-center gap-3">
      {/* Black 'M' Swoosh Mark */}
      <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center shadow-md shadow-slate-900/10 shrink-0">
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-white"
        >
          {/* Stylized Modern 'M' Swoosh */}
          <path
            d="M6 24V9L13.5 18.5L18.5 12L21 16"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M18 9L26 24"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="26" cy="8" r="2.5" fill="#3b82f6" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-base tracking-tight text-slate-900">
              Majestronicz
            </span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              ERP
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
