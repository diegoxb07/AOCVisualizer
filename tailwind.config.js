/** Tailwind config for the static build (css/tailwind.css).
 *  Regenerate after adding/removing Tailwind classes in index.html or js/*.js:
 *    npx tailwindcss@3 -i tailwind.input.css -o css/tailwind.css --minify
 *  Theme matches the old cdn.tailwindcss.com inline config exactly. */
module.exports = {
  content: ['./index.html', './js/*.js'],
  // Classes toggled from JS (classList.add/toggle), listed explicitly so a scanner
  // miss can never drop one from the compiled CSS.
  safelist: [
    'hidden', 'flex', 'block', 'grayscale', 'grayscale-0', 'saturate-0',
    'opacity-40', 'opacity-50', 'opacity-60', 'opacity-70', 'pointer-events-none', 'cursor-not-allowed',
    'text-blue-400', 'text-slate-500', 'text-slate-300', 'text-blue-100',
    'font-semibold', 'font-medium', 'border-2', 'border-blue-400', 'border-blue-500',
    'bg-slate-700', 'bg-slate-800', 'bg-blue-950/65', 'bg-blue-600', 'bg-blue-800',
    'hover:bg-blue-500', 'hover:bg-blue-700', 'ring-1', 'ring-blue-400/80',
    'scale-[1.01]', 'shadow-[0_0_0_2px_rgba(59,130,246,0.65)]',
    'accent-blue-500', 'w-3.5', 'h-3.5'
  ],
  theme: {
    extend: {
      // Console redesign: 'slate' remapped to a deep-plum shell, 'blue' remapped to a true sky-blue
      // accent (tier-for-tier same lightness progression as Tailwind's own default 'sky' scale), so
      // every existing text-slate-*/bg-blue-*/border-slate-* class rethemes with no per-element churn.
      colors: {
        slate: {50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617'},
        blue:  {100:'#e0f2fe',200:'#bae6fd',300:'#7dd3fc',400:'#38bdf8',500:'#0ea5e9',600:'#0284c7',700:'#0369a1',800:'#075985',900:'#0c4a6e',950:'#082f49'}
      },
      fontFamily: {
        sans: ['Manrope','ui-sans-serif','system-ui','sans-serif'],
        mono: ['IBM Plex Mono','ui-monospace','SFMono-Regular','monospace'],
        serif: ['Manrope','sans-serif']
      }
    }
  }
};
