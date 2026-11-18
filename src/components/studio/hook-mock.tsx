/**
 * Animated 9:16 mock of each house hook (services/creative/hooks.data.ts H01–H35): what frame 1 shows and the
 * move that follows, drawn with a plain bottle and simple shapes so the template reads at a glance. Pure SVG + CSS,
 * loops every 2.4 s. Real examples from finished ads sit next to it in the gallery where an Ad Studio style matches.
 */
import { createContext, useContext, type ReactNode } from "react";

const W = 90, H = 160;
const CSS = `
.hm *{transform-box:fill-box;transform-origin:center}
.hm .spin{animation:hm-spin 2.4s ease-in-out infinite}@keyframes hm-spin{0%,100%{transform:scaleX(1)}25%{transform:scaleX(.15)}50%{transform:scaleX(-1)}75%{transform:scaleX(.15)}}
.hm .pull{animation:hm-pull 2.4s ease-out infinite}@keyframes hm-pull{0%{transform:scale(3.2)}60%,100%{transform:scale(1)}}
.hm .push{animation:hm-push 2.4s ease-in infinite}@keyframes hm-push{0%,20%{transform:scale(.55)}80%,100%{transform:scale(1.9)}}
.hm .glint{animation:hm-glint 2.4s ease-in-out infinite}@keyframes hm-glint{0%{transform:translateX(-70px) skewX(-20deg)}60%,100%{transform:translateX(70px) skewX(-20deg)}}
.hm .lid{animation:hm-lid 2.4s ease-out infinite}@keyframes hm-lid{0%,15%{transform:translateY(0)}60%,100%{transform:translateY(-34px) rotate(-12deg)}}
.hm .rise{animation:hm-rise 2.4s ease-out infinite}@keyframes hm-rise{0%,25%{transform:translateY(26px);opacity:0}70%,100%{transform:translateY(0);opacity:1}}
.hm .pop{animation:hm-pop 2.4s cubic-bezier(.2,1.6,.4,1) infinite}@keyframes hm-pop{0%,10%{transform:scale(0)}35%,100%{transform:scale(1)}}
.hm .pop2{animation:hm-pop2 2.4s cubic-bezier(.2,1.6,.4,1) infinite}@keyframes hm-pop2{0%,40%{transform:scale(0)}65%,100%{transform:scale(1)}}
.hm .pop3{animation:hm-pop3 2.4s cubic-bezier(.2,1.6,.4,1) infinite}@keyframes hm-pop3{0%,65%{transform:scale(0)}85%,100%{transform:scale(1)}}
.hm .slam{animation:hm-slam 2.4s ease-in infinite}@keyframes hm-slam{0%,20%{transform:scale(2.6);opacity:0}40%{transform:scale(.92);opacity:1}48%,100%{transform:scale(1)}}
.hm .wipe{animation:hm-wipe 2.4s ease-in-out infinite}@keyframes hm-wipe{0%,15%{transform:translateX(-46px)}70%,100%{transform:translateX(0)}}
.hm .type{animation:hm-type 2.4s steps(10) infinite}@keyframes hm-type{0%{transform:scaleX(0)}60%,100%{transform:scaleX(1)}}
.hm .type{transform-origin:left}
.hm .shake{animation:hm-shake .3s linear infinite}@keyframes hm-shake{0%{transform:translate(0,0)}25%{transform:translate(2px,-1px)}50%{transform:translate(-2px,1px)}75%{transform:translate(1px,2px)}}
.hm .drop{animation:hm-drop 2.4s cubic-bezier(.5,0,1,.5) infinite}@keyframes hm-drop{0%{transform:translateY(-110px)}55%,100%{transform:translateY(0)}}
.hm .ripple{animation:hm-ripple 2.4s ease-out infinite;opacity:0}@keyframes hm-ripple{0%,55%{transform:scale(.2);opacity:0}60%{opacity:.9}100%{transform:scale(2.2);opacity:0}}
.hm .swirl{animation:hm-swirl 2.4s linear infinite}@keyframes hm-swirl{to{transform:rotate(360deg)}}
.hm .blink{animation:hm-blink 2.4s steps(1) infinite}@keyframes hm-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.hm .blink2{animation:hm-blink2 2.4s steps(1) infinite}@keyframes hm-blink2{0%,49%{opacity:0}50%,100%{opacity:1}}
.hm .talk{animation:hm-talk .4s ease-in-out infinite alternate}@keyframes hm-talk{from{transform:scaleY(.3)}to{transform:scaleY(1)}}
.hm .count3{animation:hm-c3 2.4s steps(1) infinite}@keyframes hm-c3{0%,32%{opacity:1}33%,100%{opacity:0}}
.hm .count2{animation:hm-c2 2.4s steps(1) infinite}@keyframes hm-c2{0%,32%{opacity:0}33%,65%{opacity:1}66%,100%{opacity:0}}
.hm .count1{animation:hm-c1 2.4s steps(1) infinite}@keyframes hm-c1{0%,65%{opacity:0}66%,100%{opacity:1}}
.hm .stepin{animation:hm-step 2.4s steps(4) infinite}@keyframes hm-step{0%{transform:translateY(30px)}80%,100%{transform:translateY(0)}}
.hm .zoomout{animation:hm-zo 2.4s ease-in-out infinite}@keyframes hm-zo{0%,30%{transform:scale(.35) translateY(40px)}80%,100%{transform:scale(1) translateY(0)}}
.hm .snow{animation:hm-snow 2.4s linear infinite}@keyframes hm-snow{from{transform:translateY(-20px)}to{transform:translateY(40px)}}
.hm .ramp{animation:hm-ramp 2.4s cubic-bezier(.1,.9,.2,1) infinite}@keyframes hm-ramp{0%{transform:translateX(-60px)}100%{transform:translateX(60px)}}
`;

/** the user's own product photo and logo (typed in the Ad Studio panel); empty = the plain bottle */
export const MockBrand = createContext<{ product?: string; logo?: string }>({});

/** plain bottle: white body, light-blue cap — or the typed product photo in the same place */
function Bottle({ x = 45, y = 92, s = 1, cls = "" }: { x?: number; y?: number; s?: number; cls?: string }) {
  const { product } = useContext(MockBrand);
  if (product) {
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <g className={cls}><image data-testid="hook-mock-product" href={product} x={-22} y={-42} width={44} height={68} preserveAspectRatio="xMidYMid meet" /></g>
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className={cls}>
        <rect x={-6} y={-38} width={12} height={10} rx={2} fill="#7cc8e8" />
        <rect x={-13} y={-29} width={26} height={52} rx={6} fill="#f4f4f2" stroke="#cfcfcf" strokeWidth={0.8} />
        <rect x={-9} y={-12} width={18} height={10} rx={1.5} fill="#e4e8ea" />
      </g>
    </g>
  );
}
const Text = ({ x = 45, y, t, size = 9, fill = "#fff", cls = "", bg }: { x?: number; y: number; t: string; size?: number; fill?: string; cls?: string; bg?: string }) => (
  <g className={cls}>
    {bg && <rect x={x - (t.length * size * 0.32) - 4} y={y - size} width={t.length * size * 0.64 + 8} height={size * 1.45} rx={3} fill={bg} />}
    <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={800} fill={fill} fontFamily="Arial, Helvetica, sans-serif">{t}</text>
  </g>
);
const Person = ({ x = 45, y = 70, s = 1, cls = "", mouth = false }: { x?: number; y?: number; s?: number; cls?: string; mouth?: boolean }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <g className={cls}>
      <circle cx={0} cy={0} r={14} fill="#e8c4a8" />
      <rect x={-22} y={16} width={44} height={40} rx={14} fill="#5b6b7a" />
      <circle cx={-5} cy={-2} r={1.6} fill="#333" /><circle cx={5} cy={-2} r={1.6} fill="#333" />
      {mouth && <ellipse className="talk" cx={0} cy={7} rx={4} ry={2.6} fill="#8a3b3b" />}
    </g>
  </g>
);
const Bubble = ({ y, w = 60, left = true, cls = "", fill = "#fff" }: { y: number; w?: number; left?: boolean; cls?: string; fill?: string }) => (
  <rect className={cls} x={left ? 10 : W - 10 - w} y={y} width={w} height={14} rx={7} fill={fill} />
);

const BG: Record<string, string> = { dark: "#1d2228", light: "#eef0f2", warm: "#3a2a22", brand: "#2b5f75", green: "#2e4a3a", red: "#5a2228" };

/** each hook's scene: background tone + animated content */
const SCENES: Record<string, { bg: keyof typeof BG; el: ReactNode }> = {
  H01: { bg: "dark", el: <><ellipse cx={45} cy={118} rx={26} ry={5} fill="#000" opacity={0.35} /><Bottle cls="spin" /><Text y={140} t="4K · HDR" size={8} cls="pop2" /></> },
  H02: { bg: "dark", el: <Bottle cls="pull" /> },
  H03: { bg: "dark", el: <><Bottle /><rect className="glint" x={40} y={40} width={10} height={90} fill="#fff" opacity={0.55} /></> },
  H04: { bg: "brand", el: <Bottle cls="push" /> },
  H05: { bg: "warm", el: <><rect x={22} y={90} width={46} height={34} rx={3} fill="#c9a87c" /><Bottle y={100} s={0.8} cls="rise" /><rect className="lid" x={20} y={84} width={50} height={9} rx={2} fill="#b8946a" /></> },
  H06: { bg: "red", el: <><rect x={22} y={84} width={46} height={40} rx={3} fill="#d43c4c" /><rect className="lid" x={42} y={80} width={6} height={48} fill="#f5c542" /><Bottle y={96} s={0.75} cls="pop2" /></> },
  H07: { bg: "dark", el: <><Person y={70} s={1.5} cls="pop" /><Text y={140} t="WAIT WHAT" size={9} cls="pop2" /></> },
  H08: { bg: "light", el: <><Bottle y={88} /><path className="rise" d="M20 160 Q30 120 38 112 L44 116 Q36 130 34 160 Z" fill="#e8c4a8" /><path className="rise" d="M70 160 Q60 120 52 112 L46 116 Q54 130 56 160 Z" fill="#e8c4a8" /><Text y={22} t="POV:" size={9} fill="#222" /></> },
  H09: { bg: "dark", el: <><g className="blink"><Text y={70} t="✕ PROBLEM" size={9} fill="#ff6b6b" /></g><g className="blink2"><Bottle /><Text y={140} t="✓ FIXED" size={9} fill="#6be08a" /></g></> },
  H10: { bg: "dark", el: <><rect x={0} y={0} width={45} height={H} fill="#6b5a4e" /><rect x={45} y={0} width={45} height={H} fill="#9ec9d8" /><Text x={22} y={20} t="BEFORE" size={7} /><Text x={68} y={20} t="AFTER" size={7} /><rect className="wipe" x={44} y={0} width={2} height={H} fill="#fff" /></> },
  H11: { bg: "light", el: <><g className="swirl"><circle cx={45} cy={80} r={22} fill="#bfe3f1" /><circle cx={38} cy={74} r={9} fill="#e9f6fb" /><circle cx={53} cy={88} r={7} fill="#9fd3e7" /></g><Text y={140} t="ASMR" size={8} fill="#555" /></> },
  H12: { bg: "dark", el: <><rect className="ramp" x={20} y={60} width={50} height={3} fill="#fff" opacity={0.5} /><rect className="ramp" x={20} y={80} width={50} height={3} fill="#fff" opacity={0.5} /><Bottle cls="pop2" /></> },
  H13: { bg: "brand", el: <><Bottle /><g className="pop"><circle cx={20} cy={40} r={11} fill="#f5c542" /><Text x={20} y={44} t="1" size={12} fill="#111" /></g><Text y={140} t="3 REASONS" size={9} cls="pop2" /></> },
  H14: { bg: "brand", el: <><Text y={70} t="Still doing" size={10} /><Text y={86} t="10 steps?" size={10} cls="type" /></> },
  H15: { bg: "dark", el: <><Text y={78} t="87%" size={28} fill="#f5c542" cls="slam" /><Text y={100} t="saw it in 3 days" size={7} cls="pop2" /></> },
  H16: { bg: "red", el: <><Bottle y={70} s={0.8} /><Text y={124} t="$28" size={10} fill="#ddd" /><rect x={30} y={119} width={30} height={2} fill="#ff4b4b" className="pop" /><Text y={146} t="$22" size={18} fill="#f5c542" cls="slam" /></> },
  H17: { bg: "warm", el: <><Person y={66} s={1.3} mouth /><Text y={140} t="ok so…" size={8} cls="pop2" bg="#000" /></> },
  H18: { bg: "light", el: <><rect x={10} y={14} width={70} height={80} rx={4} fill="#fff" stroke="#ccc" /><rect x={16} y={22} width={58} height={6} fill="#ddd" /><rect x={16} y={34} width={40} height={6} fill="#ddd" /><Person y={118} s={0.8} mouth /></> },
  H19: { bg: "light", el: <><g className="stepin"><Bottle /></g><rect className="pop" x={14} y={118} width={14} height={8} fill="#c9a87c" /><rect className="pop2" x={62} y={118} width={14} height={8} fill="#9fd3e7" /></> },
  H20: { bg: "light", el: <><rect x={8} y={30} width={44} height={100} rx={6} fill="#c9ced3" /><Bottle x={66} y={112} s={0.5} cls="pop2" /><Text x={66} y={142} t="tiny" size={7} fill="#333" /></> },
  H21: { bg: "warm", el: <><Text y={24} t="TikTok made me buy" size={7} bg="#000" /><Bottle y={96} cls="pop" /><rect x={10} y={124} width={70} height={30} fill="#5a4535" /></> },
  H22: { bg: "dark", el: <><Bottle cls="drop" /><circle className="ripple" cx={45} cy={118} r={12} fill="none" stroke="#fff" strokeWidth={2} /><Text y={24} t="DROP TEST" size={8} /></> },
  H23: { bg: "green", el: <><circle cx={70} cy={30} r={10} fill="#f5d27a" /><rect x={0} y={120} width={W} height={40} fill="#3f5f45" /><Person x={45} y={84} s={0.7} cls="ramp" /></> },
  H24: { bg: "red", el: <><g className="snow"><circle cx={15} cy={10} r={1.6} fill="#fff" /><circle cx={45} cy={0} r={1.6} fill="#fff" /><circle cx={75} cy={12} r={1.6} fill="#fff" /><circle cx={30} cy={30} r={1.6} fill="#fff" /><circle cx={62} cy={36} r={1.6} fill="#fff" /></g><Bottle cls="pop2" /><Text y={146} t="HOLIDAY" size={8} fill="#f5c542" /></> },
  H25: { bg: "light", el: <><rect x={10} y={40} width={70} height={14} rx={7} fill="#fff" stroke="#bbb" /><rect className="type" x={16} y={45} width={50} height={4} fill="#555" /><Bottle y={110} s={0.7} cls="pop3" /></> },
  H26: { bg: "dark", el: <><Bottle y={100} /><g className="pop"><rect x={8} y={24} width={74} height={24} rx={6} fill="#fff" /><circle cx={17} cy={36} r={5} fill="#9fd3e7" /><rect x={26} y={30} width={48} height={4} fill="#999" /><rect x={26} y={38} width={36} height={4} fill="#ccc" /></g></> },
  H27: { bg: "light", el: <><Bubble y={30} cls="pop" fill="#e2e5e8" /><Bubble y={52} left={false} cls="pop2" fill="#3b8cf5" /><Bubble y={74} w={44} cls="pop3" fill="#e2e5e8" /><Bottle y={128} s={0.5} cls="pop3" /></> },
  H28: { bg: "brand", el: <g className="shake"><Text y={78} t="STOP" size={22} cls="slam" /><Text y={98} t="scrolling" size={9} /></g> },
  H29: { bg: "light", el: <><rect x={45} y={0} width={1} height={H} fill="#bbb" /><Bottle x={24} y={88} s={0.75} /><Bottle x={67} y={88} s={0.75} /><Text x={24} y={136} t="✕" size={12} fill="#e05555" cls="pop" /><Text x={67} y={136} t="✓" size={12} fill="#2fa45b" cls="pop2" /></> },
  H30: { bg: "dark", el: <><Text y={68} t="MYTH:" size={9} fill="#ff6b6b" cls="blink" /><Text y={68} t="FACT:" size={9} fill="#6be08a" cls="blink2" /><Text y={86} t="more steps = better" size={7} /></> },
  H31: { bg: "light", el: <><Bottle y={86} /><path className="shake" d="M44 40 Q52 30 62 36 L58 50 Q50 46 46 50 Z" fill="#e8c4a8" /><circle className="ripple" cx={45} cy={56} r={8} fill="#bfe3f1" /></> },
  H32: { bg: "brand", el: <><Text y={60} t="#3" size={22} fill="#f5c542" cls="count3" /><Text y={60} t="#2" size={22} fill="#f5c542" cls="count2" /><g className="count1"><Text y={60} t="#1" size={22} fill="#f5c542" /><Bottle y={110} s={0.7} /></g></> },
  H33: { bg: "dark", el: <><rect x={0} y={0} width={W} height={80} fill="#3b4652" /><Person y={44} s={0.7} /><rect x={0} y={80} width={W} height={80} fill="#2b5f75" /><Person y={118} s={0.7} mouth /></> },
  H34: { bg: "green", el: <><rect x={0} y={110} width={W} height={50} fill="#3f5f45" /><path d="M0 110 L30 70 L55 100 L75 60 L90 90 L90 110 Z" fill="#567a5c" /><Bottle cls="zoomout" /></> },
  H35: { bg: "brand", el: <><rect x={0} y={112} width={W} height={48} fill="#4ba3c7" /><Bottle cls="drop" /><circle className="ripple" cx={45} cy={114} r={14} fill="none" stroke="#fff" strokeWidth={2} /></> },
};

export function HookMock({ id, className }: { id: string; className?: string }) {
  const sc = SCENES[id];
  const { logo } = useContext(MockBrand);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${id} hook animation`} className={`hm ${className ?? ""}`}>
      <rect width={W} height={H} rx={6} fill={BG[sc?.bg ?? "dark"]} />
      {sc?.el ?? <Bottle />}
      {logo && <image data-testid="hook-mock-logo" href={logo} x={4} y={4} width={30} height={12} preserveAspectRatio="xMinYMid meet" />}
    </svg>
  );
}
export const HOOK_MOCK_IDS = Object.keys(SCENES);
/** the animation styles — render once per page, next to the mocks */
export const HookMockStyle = () => <style>{CSS}</style>;
