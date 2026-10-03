import { useEffect, useRef, useState } from "react";

// Animate only the first loaded presentation. Preserve the original formatted
// value for assistive technology, subsequent updates and reduced-motion users.
export function CountUp({ value }: { value: string | number }) {
  const text = String(value);
  const match = text.match(/^([^0-9]*)([0-9][0-9,]*(?:\.[0-9]+)?)([^0-9]*)$/);
  const amount = match ? Number(match[2].replaceAll(",", "")) : NaN;
  const [display, setDisplay] = useState(text);
  const [finished, setFinished] = useState(false);
  const initial = useRef({ text, match, amount });
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const first = initial.current;
    if (media.matches || !first.match || !Number.isFinite(first.amount)) { setFinished(true); return; }
    let frame = 0;
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      setDisplay(first.text);
      setFinished(true);
    };
    const onPreference = () => { if (media.matches) stop(); };
    media.addEventListener("change", onPreference);
    const start = performance.now();
    const decimals = first.match[2].split(".")[1]?.length ?? 0;
    const comma = first.match[2].includes(",");
    const tick = (now: number) => {
      if (cancelled) return;
      const progress = Math.min(1, (now - start) / 180);
      if (progress === 1) { stop(); return; }
      const formatted = (first.amount * progress).toFixed(decimals);
      const [integer, fraction] = formatted.split(".");
      const number = (comma ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integer) + (fraction === undefined ? "" : `.${fraction}`);
      setDisplay(`${first.match![1]}${number}${first.match![3]}`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); media.removeEventListener("change", onPreference); };
  }, []);
  return <><span aria-hidden="true" className="count-up-visual" data-value={finished || text !== initial.current.text ? text : display} data-final={text} /><span className="sr-only">{text}</span></>;
}