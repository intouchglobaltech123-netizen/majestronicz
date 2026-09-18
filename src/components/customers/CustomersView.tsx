import React from 'react';
import { PartiesView } from '../parties/PartiesView';

/**
 * CustomersView delegates to the unified PartiesView on the 'customers' tab.
 * This preserves backwards compatibility for any existing routes or components.
 */
export const CustomersView: React.FC = () => {
  return <PartiesView initialTab="customers" />;
};
