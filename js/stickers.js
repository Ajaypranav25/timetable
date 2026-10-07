/*
 * Sticker artwork for the landing hero and the mouse trail. Static, hand-written SVG
 * (inline so the page's pixel font applies to the text inside).
 */
(function (root) {
  'use strict';
  var FONT = 'font-family="SkipDigits, Silkscreen, monospace" font-weight="700"';

  var STICKERS = {
    calendar:
      '<svg viewBox="0 0 120 130"><g transform="rotate(-10 60 65)">' +
        '<rect x="12" y="18" width="96" height="98" rx="12" fill="#fff"/>' +
        '<rect x="20" y="26" width="80" height="82" rx="6" fill="#111"/>' +
        '<rect x="20" y="26" width="80" height="20" rx="6" fill="#b8f84a"/>' +
        '<rect x="34" y="12" width="8" height="22" rx="3" fill="#fff" stroke="#111" stroke-width="3"/>' +
        '<rect x="78" y="12" width="8" height="22" rx="3" fill="#fff" stroke="#111" stroke-width="3"/>' +
        '<g fill="#fff"><rect x="28" y="54" width="12" height="10"/><rect x="46" y="54" width="12" height="10"/><rect x="64" y="54" width="12" height="10"/><rect x="82" y="54" width="10" height="10"/><rect x="28" y="70" width="12" height="10"/><rect x="64" y="70" width="12" height="10"/><rect x="82" y="70" width="10" height="10"/><rect x="28" y="86" width="12" height="10"/><rect x="46" y="86" width="12" height="10"/></g>' +
        '<path d="M44 66 L60 82 M60 66 L44 82" stroke="#e8141b" stroke-width="5"/></g></svg>',
    proxy:
      '<svg viewBox="0 0 220 90"><g transform="rotate(-6 110 45)">' +
        '<ellipse cx="110" cy="45" rx="104" ry="38" fill="#fff"/>' +
        '<ellipse cx="110" cy="45" rx="98" ry="32" fill="#111"/>' +
        '<ellipse cx="110" cy="45" rx="92" ry="26" fill="#ffe22e"/>' +
        '<text x="110" y="54" text-anchor="middle" ' + FONT + ' font-size="24" fill="#111" font-style="italic">NO PROXY</text></g></svg>',
    flower:
      '<svg viewBox="0 0 120 120"><g stroke="#111" stroke-width="5" fill="#ffe22e">' +
        '<circle cx="60" cy="26" r="22"/><circle cx="93" cy="50" r="22"/><circle cx="80" cy="89" r="22"/><circle cx="40" cy="89" r="22"/><circle cx="27" cy="50" r="22"/></g>' +
        '<circle cx="60" cy="60" r="24" fill="#e8141b" stroke="#111" stroke-width="5"/>' +
        '<text x="60" y="68" text-anchor="middle" ' + FONT + ' font-size="20" fill="#fff">75</text></svg>',
    badge:
      '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#fff"/><circle cx="60" cy="60" r="50" fill="#1f3bff" stroke="#111" stroke-width="4"/>' +
        '<circle cx="60" cy="60" r="40" fill="none" stroke="#b8f84a" stroke-width="2" stroke-dasharray="4 5"/>' +
        '<text x="60" y="58" text-anchor="middle" ' + FONT + ' font-size="26" fill="#b8f84a">75%</text>' +
        '<text x="60" y="80" text-anchor="middle" ' + FONT + ' font-size="11" fill="#fff">OR BUST</text></svg>',
    debar:
      '<svg viewBox="0 0 200 90"><g transform="rotate(-8 100 45)">' +
        '<rect x="8" y="14" width="184" height="62" rx="8" fill="#fff"/>' +
        '<rect x="14" y="20" width="172" height="50" rx="5" fill="none" stroke="#e8141b" stroke-width="5"/>' +
        '<text x="100" y="55" text-anchor="middle" ' + FONT + ' font-size="26" fill="#e8141b">DEBARRED</text></g></svg>',
    clock:
      '<svg viewBox="0 0 120 120"><g stroke="#111" stroke-width="5">' +
        '<circle cx="28" cy="26" r="16" fill="#e8141b"/><circle cx="92" cy="26" r="16" fill="#e8141b"/>' +
        '<path d="M32 104 L22 114 M88 104 L98 114" stroke-linecap="round"/>' +
        '<circle cx="60" cy="64" r="44" fill="#fff"/></g>' +
        '<path d="M60 64 L60 36 M60 64 L38 76" stroke="#111" stroke-width="6" stroke-linecap="round"/>' +
        '<circle cx="60" cy="64" r="5" fill="#e8141b"/>' +
        '<text x="60" y="96" text-anchor="middle" ' + FONT + ' font-size="12" fill="#111">8AM</text></svg>',
    skip:
      '<svg viewBox="0 0 120 120"><polygon points="60.0,4.0 70.4,21.4 88.0,11.5 88.3,31.7 108.5,32.0 98.6,49.6 116.0,60.0 98.6,70.4 108.5,88.0 88.3,88.3 88.0,108.5 70.4,98.6 60.0,116.0 49.6,98.6 32.0,108.5 31.7,88.3 11.5,88.0 21.4,70.4 4.0,60.0 21.4,49.6 11.5,32.0 31.7,31.7 32.0,11.5 49.6,21.4" fill="#b8f84a" stroke="#111" stroke-width="5" stroke-linejoin="round"/>' +
        '<text x="60" y="68" text-anchor="middle" ' + FONT + ' font-size="22" fill="#111" transform="rotate(-10 60 60)">SKIP!</text></svg>',
    present:
      '<svg viewBox="0 0 200 80"><rect x="4" y="8" width="192" height="64" rx="32" fill="#111"/>' +
        '<rect x="10" y="14" width="180" height="52" rx="26" fill="#fff"/>' +
        '<circle cx="40" cy="40" r="18" fill="#b8f84a" stroke="#111" stroke-width="4"/>' +
        '<path d="M31 40 L38 47 L50 33" fill="none" stroke="#111" stroke-width="5" stroke-linecap="square"/>' +
        '<text x="118" y="49" text-anchor="middle" ' + FONT + ' font-size="22" fill="#111">PRESENT</text></svg>',
    zzz:
      '<svg viewBox="0 0 140 110"><path d="M30 86 C6 86 4 56 26 52 C22 26 56 16 68 34 C80 10 120 18 116 46 C138 48 138 86 112 86 Z" fill="#9ec5ff" stroke="#111" stroke-width="5" stroke-linejoin="round"/>' +
        '<path d="M30 98 a6 6 0 1 0 0.1 0 M16 104 a3 3 0 1 0 0.1 0" fill="#9ec5ff" stroke="#111" stroke-width="3"/>' +
        '<text x="72" y="70" text-anchor="middle" ' + FONT + ' font-size="26" fill="#111">ZZZ</text></svg>',
    warning:
      '<svg viewBox="0 0 120 112"><path d="M60 6 L116 104 L4 104 Z" fill="#111" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>' +
        '<path d="M60 22 L102 96 L18 96 Z" fill="#ffe22e"/>' +
        '<text x="60" y="64" text-anchor="middle" ' + FONT + ' font-size="26" fill="#111">!</text>' +
        '<text x="60" y="88" text-anchor="middle" ' + FONT + ' font-size="14" fill="#111">74.99%</text></svg>',
    ticket:
      '<svg viewBox="0 0 180 90"><g transform="rotate(5 90 45)"><path d="M10 14 H170 V36 a9 9 0 0 0 0 18 V76 H10 V54 a9 9 0 0 0 0 -18 Z" fill="#ffe22e" stroke="#111" stroke-width="5"/>' +
        '<path d="M126 18 V72" stroke="#111" stroke-width="3" stroke-dasharray="5 5"/>' +
        '<text x="68" y="53" text-anchor="middle" ' + FONT + ' font-size="20" fill="#111">ON DUTY</text>' +
        '<text x="148" y="53" text-anchor="middle" ' + FONT + ' font-size="18" fill="#e8141b">OD</text></g></svg>'
  };

  /** Order the trail cycles through: alternate shapes and colours so neighbours never match. */
  var TRAIL = ['skip', 'proxy', 'clock', 'badge', 'debar', 'flower', 'present', 'zzz', 'warning', 'calendar', 'ticket'];

  root.VAP = root.VAP || {};
  root.VAP.stickers = { svg: STICKERS, trail: TRAIL };
})(typeof self !== 'undefined' ? self : this);
