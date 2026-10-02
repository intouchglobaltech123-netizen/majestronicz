import React from 'react';
import { useErp } from '../../context/ErpContext';

/**
 * FIN-A-9: while the older bills are still loading in the background (the first
 * load carries the recent window only), screens that list or total bills say
 * so — the same hint the Reports header shows.
 */
export const HistoryLoadingHint: React.FC<{ className?: string }> = ({ className }) => {
  const { historyLoading } = useErp();
  if (!historyLoading) return null;
  return (
    <span className={className ?? 'text-amber-700'} data-testid="history-loading">
      {' '}· loading older bills…
    </span>
  );
};
