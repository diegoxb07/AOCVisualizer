/** Tailwind config for the static build (css/tailwind.css).
 *  Regenerate after adding/removing Tailwind classes in index.html or js/*.js:
 *    npx tailwindcss@3 -i tailwind.input.css -o css/tailwind.css --minify
 *  Theme matches the old cdn.tailwindcss.com inline config exactly. */
module.exports = {
  content: ['./index.html', './js/*.js'],
  // Classes toggled from JS (classList.add/toggle) - listed explicitly so a scanner
  // miss can never drop one from the compiled CSS.
  safelist: [
    'hidden', 'flex', 'block', 'grayscale', 'grayscale-0', 'saturate-0',
    'opacity-40', 'opacity-50', 'opacity-60', 'opacity-70', 'pointer-events-none', 'cursor-not-allowed',
    'text-emerald-400', 'text-slate-500', 'text-slate-300', 'text-blue-100',
    'font-semibold', 'font-medium', 'border-2', 'border-blue-400', 'border-blue-500',
    'bg-slate-700', 'bg-slate-800', 'bg-blue-950/65', 'bg-blue-600', 'bg-blue-800',
    'hover:bg-blue-500', 'hover:bg-blue-700', 'ring-1', 'ring-blue-400/80',
    'scale-[1.01]', 'shadow-[0_0_0_2px_rgba(59,130,246,0.65)]',
    'accent-sky-500', 'w-3.5', 'h-3.5'
  ],
  theme: {
    extend: {
      colors: {
        slate: {50:'#eef1f4',100:'#dce1e7',200:'#c8d0d8',300:'#aab4be',400:'#7c8794',500:'#5d6773',600:'#454e58',700:'#343c46',800:'#20262f',900:'#161b22',950:'#0b0e13'},
        blue:  {300:'#7dd3fc',400:'#38bdf8',500:'#0ea5e9',600:'#0284c7',700:'#0369a1',800:'#075985',900:'#0c4a6e'}
      },
      fontFamily: {
        sans: ['Inter','ui-sans-serif','system-ui','sans-serif'],
        mono: ['Roboto Mono','ui-monospace','SFMono-Regular','monospace']
      }
    }
  }
};
