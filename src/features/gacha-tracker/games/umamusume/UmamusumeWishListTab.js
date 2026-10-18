import React, { useEffect, useRef } from 'react';
import './UmamusumeWishListTab.css';

// Umamusume's Wish List tab is the carat calculator's own planner, embedded
// as-is (umacaratcalculator.com, MIT-licensed, run by a third party) instead
// of a Wish List built from our own pity model — that tab's list/target
// concepts assume the pity-and-50/50 games. Needs an internet connection.
//
// A <webview>, not an <iframe>: the site's Discord/Google/Patreon login is a
// full-page redirect (to the provider and back to /auth/callback), and it
// parks its pending login state in the browser's own storage first. In a
// webview that whole round trip happens inside one browsing context with its
// own persistent storage, so the login completes and stays signed in. (An
// external-browser login was tried and dropped: it needs the user to copy the
// callback address back by hand, because the callback + token must land in the
// same storage that holds the pending state.)
// The webview is locked down in electron/main.js ('will-attach-webview').
const PLANNER_URL = 'https://umacaratcalculator.com/app';

// The app's own scrollbar (shared/components/ScrollArea.js) is a 4px rounded
// thumb on a transparent track, coloured with the theme's --border-bright.
// ScrollArea can't reach into another page, so this is the same look as plain
// ::-webkit-scrollbar rules, injected into the embedded page. The colour is
// read from the app's current theme at injection time. `!important` because
// the site may style its own scrollbars.
function scrollbarCss() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--border-bright').trim() || '#3a3a50';
  return `
    ::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
    ::-webkit-scrollbar-track { background: transparent !important; }
    ::-webkit-scrollbar-thumb {
      background: ${color} !important;
      border: 2px solid transparent !important;
      background-clip: padding-box !important;
      border-radius: 4px !important;
    }
    ::-webkit-scrollbar-corner { background: transparent !important; }
  `;
}

export default function UmamusumeWishListTab() {
  const frameRef = useRef(null);

  // Inject the scrollbar styling. insertCSS only works once the page is ready
  // and doesn't survive a full page load, so it's re-applied on every
  // 'dom-ready'; a theme change swaps the previous injection for a new one.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let ready = false;
    let cssKey = null;
    async function apply() {
      if (!ready) return;
      try {
        if (cssKey) await frame.removeInsertedCSS(cssKey);
        cssKey = await frame.insertCSS(scrollbarCss());
      } catch { /* webview gone or not attached yet */ }
    }
    const onReady = () => { ready = true; cssKey = null; apply(); };
    frame.addEventListener('dom-ready', onReady);
    const themeWatcher = new MutationObserver(apply);
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      frame.removeEventListener('dom-ready', onReady);
      themeWatcher.disconnect();
    };
  }, []);

  // The app's custom cursor is a DOM element moved by the page's own
  // mousemove events, which never fire while the pointer is over embedded
  // third-party content — so it would freeze at the edge. Hide it (via
  // index.css's `cursor-over-embed` rule) for exactly as long as the pointer
  // is over the embed; the embedded page shows the system cursor.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const root = document.documentElement;
    const enter = () => root.classList.add('cursor-over-embed');
    const leave = () => root.classList.remove('cursor-over-embed');
    frame.addEventListener('mouseenter', enter);
    frame.addEventListener('mouseleave', leave);
    return () => {
      frame.removeEventListener('mouseenter', enter);
      frame.removeEventListener('mouseleave', leave);
      leave(); // switching tabs while hovering must not leave the cursor hidden
    };
  }, []);

  return (
    <div className="uma-embed">
      <webview
        ref={frameRef}
        className="uma-embed-frame"
        src={PLANNER_URL}
        partition="persist:umamusume"
      />
    </div>
  );
}
