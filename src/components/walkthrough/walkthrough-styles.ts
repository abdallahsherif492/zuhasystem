/**
 * Popover styling for the driver.js walkthrough.
 *
 * Kept separate from the provider so the same string can be rendered in
 * isolation when checking the tour's appearance.
 */
export const walkthroughCss = `
        /* The tour copy is Arabic, but the layout follows the business's
           direction setting — hardcoding RTL here would mirror the popover
           against an LTR dashboard. */
        .ecommerx-walkthrough {
          background: linear-gradient(160deg, #1E293B 0%, #0F172A 100%) !important;
          color: white !important;
          border-radius: 18px !important;
          padding: 22px 24px 18px !important;
          max-width: 440px !important;
          min-width: 300px !important;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(99, 102, 241, 0.25) !important;
          border: none !important;
          font-family: inherit !important;
          animation: ecommerx-pop 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes ecommerx-pop {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }

        .ecommerx-walkthrough .driver-popover-title {
          font-size: 19px !important;
          font-weight: 800 !important;
          color: white !important;
          margin-bottom: 10px !important;
          line-height: 1.5 !important;
          padding-inline-end: 28px !important; /* keep clear of the close button */
        }
        .ecommerx-walkthrough .driver-popover-description {
          font-size: 14.5px !important;
          color: rgba(255, 255, 255, 0.82) !important;
          line-height: 1.95 !important;
          white-space: pre-line !important;
        }

        /* Progress: keep the text, add a bar so length is obvious at a glance */
        .ecommerx-walkthrough .driver-popover-footer {
          margin-top: 18px !important;
          padding-top: 14px !important;
          border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
          align-items: center !important;
        }
        .ecommerx-walkthrough .driver-popover-progress-text {
          color: rgba(255, 255, 255, 0.55) !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          letter-spacing: 0.2px !important;
        }

        .ecommerx-walkthrough .driver-popover-navigation-btns {
          gap: 8px !important;
          flex: 0 0 auto !important;
        }
        .ecommerx-walkthrough .driver-popover-next-btn,
        .ecommerx-walkthrough .driver-popover-prev-btn {
          background: #6366F1 !important;
          color: white !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 9px 18px !important;
          font-weight: 700 !important;
          font-size: 13.5px !important;
          text-shadow: none !important;
          transition: background 0.18s, transform 0.18s !important;
        }
        .ecommerx-walkthrough .driver-popover-prev-btn {
          background: rgba(255, 255, 255, 0.09) !important;
          color: rgba(255, 255, 255, 0.75) !important;
        }
        .ecommerx-walkthrough .driver-popover-next-btn:hover {
          background: #4F46E5 !important;
          transform: translateY(-1px) !important;
        }
        .ecommerx-walkthrough .driver-popover-prev-btn:hover {
          background: rgba(255, 255, 255, 0.16) !important;
          color: white !important;
        }
        .ecommerx-walkthrough .driver-popover-close-btn {
          color: rgba(255, 255, 255, 0.45) !important;
          font-size: 22px !important;
          width: 30px !important;
          height: 30px !important;
          line-height: 26px !important;
          border-radius: 8px !important;
          transition: all 0.18s !important;
        }
        .ecommerx-walkthrough .driver-popover-close-btn:hover {
          color: white !important;
          background: rgba(255, 255, 255, 0.1) !important;
        }

        /* Arrow must match the popover's gradient, not the old flat navy */
        .ecommerx-walkthrough .driver-popover-arrow-side-top    { border-top-color: #0F172A !important; }
        .ecommerx-walkthrough .driver-popover-arrow-side-bottom { border-bottom-color: #1E293B !important; }
        .ecommerx-walkthrough .driver-popover-arrow-side-left   { border-left-color: #16213A !important; }
        .ecommerx-walkthrough .driver-popover-arrow-side-right  { border-right-color: #16213A !important; }

        /* Dim the page more than before so the highlighted element reads as
           the subject of the step rather than just another bright box. */
        .driver-overlay, .driver-overlay path {
          fill: rgba(15, 23, 42, 0.62) !important;
          background: rgba(15, 23, 42, 0.62) !important;
        }
        .driver-active-element {
          outline: 3px solid #6366F1 !important;
          outline-offset: 4px !important;
          border-radius: 10px !important;
          transition: outline-color 0.2s !important;
        }
      `;
