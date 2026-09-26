import React from 'react';

/**
 * Small marketplace marks for the Online Store menu.
 *
 * Drawn inline rather than loaded from a CDN: the app runs on shop machines
 * with unreliable connections, and a menu whose icons sometimes fail to appear
 * looks broken. These are simple recognisable glyphs in each brand's colour —
 * a bag, a cart, a smile — not the registered logos, which we have no licence
 * to ship.
 */

interface LogoProps {
  className?: string;
}

export const ShopifyMark: React.FC<LogoProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#5E8E3E"
      d="M15.3 4.6c-.1-.1-.3-.1-.4-.1l-1 .2c-.3-.9-.9-1.8-1.9-1.8h-.2c-.3-.4-.7-.6-1.1-.6-1.6 0-2.7 2-3.1 3.5l-1.3.4c-.4.1-.4.2-.5.6L4.3 19.6l8.1 1.5 4.4-1V5.1c0-.2-.1-.4-.2-.5h-1.3ZM11 5.3l-1.4.4c.3-1.1.9-1.9 1.4-2.1v1.7Zm-.7-2.3c.1 0 .2 0 .3.1-.6.5-1.2 1.6-1.5 3l-1.2.4c.4-1.4 1.3-3.5 2.4-3.5Zm1.4 2.1V3.4c.5.1.9.6 1.1 1.4l-1.1.3Z"
    />
    <path
      fill="#FFF"
      d="M12.8 9.9l-.5 1.5s-.5-.3-1.2-.3c-1 0-1 .6-1 .8 0 .9 2.3 1.2 2.3 3.3 0 1.6-1 2.7-2.4 2.7-1.7 0-2.5-1-2.5-1l.5-1.5s.9.7 1.6.7c.5 0 .7-.4.7-.6 0-1.2-1.9-1.3-1.9-3.2 0-1.6 1.1-3.1 3.4-3.1.9 0 1 .7 1 .7Z"
    />
  </svg>
);

export const FlipkartMark: React.FC<LogoProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect width="24" height="24" rx="3" fill="#2874F0" />
    <path fill="#FFE11B" d="M6.5 6h11v1.6h-11z" />
    <path
      fill="#FFF"
      d="M8.6 9.3h2.1v1.3H9.9v6.1H8.3v-6.1h-.8V9.3h.8v-.5c0-1.3.6-2 1.9-2h.5v1.4h-.3c-.5 0-.7.2-.7.7v.4Zm4.2 0h1.6v7.4h-1.6V9.3Z"
    />
  </svg>
);

export const AmazonMark: React.FC<LogoProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#232F3E"
      d="M7.5 9.1c0-1.9 1.4-3 3.3-3 1.2 0 2.4.4 2.9 1.5.3.7.3 1.4.3 2.1v2.6c0 .6.2.9.5 1.3l-1.4 1.1c-.3-.3-.5-.6-.7-.9-.7.7-1.4 1-2.5 1-1.5 0-2.7-.9-2.7-2.7 0-1.4.8-2.4 1.9-2.8 1-.4 2.3-.4 3.3-.5v-.2c0-.4 0-.9-.2-1.2-.2-.3-.6-.4-1-.4-.7 0-1.3.4-1.4 1.1l-1.9-.2Zm4.9 2.2c-.6 0-1.3.1-1.8.3-.5.3-.8.7-.8 1.3 0 .7.4 1.1 1 1.1.5 0 .9-.3 1.2-.8.3-.5.3-1 .3-1.6v-.3Z"
    />
    <path
      fill="#FF9900"
      d="M18.6 17c-1.9 1.4-4.6 2.1-7 2.1-3.3 0-6.2-1.2-8.5-3.2-.2-.2 0-.4.2-.3 2.4 1.4 5.4 2.3 8.5 2.3 2.1 0 4.4-.4 6.5-1.3.3-.1.6.2.3.4Zm.8-.9c-.2-.3-1.6-.1-2.2 0-.2 0-.2-.1-.1-.2.1-.8 1.5-.7 2-.3.5.4-.1 1.9-.6 2.4-.1.1-.2.1-.2 0 .1-.5.3-1.6.1-1.9Z"
    />
  </svg>
);
